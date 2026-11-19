import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { publicCatalog } from "../catalog-read.ts";
import type { Database } from "../local-d1.ts";
import { dateAt } from "../model.ts";

const text = z.string().trim().min(1).max(300);
const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const zone = z.string().max(100).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return !/^[+-]/.test(value); } catch { return false; }
}, "Use a named time zone");
export const stageInput = z.strictObject({
  name: text,
  eventStart: date.nullable(),
  eventEnd: date.nullable(),
  timeZone: zone.nullable(),
  format: z.enum(["in-person", "online", "hybrid", "unknown"]),
  entry: z.enum(["direct", "advancement"]),
  requiresStage: z.string().max(100).nullable(),
  fixedAttendance: z.boolean(),
}).superRefine((row, ctx) => {
  if (row.entry === "advancement" && !row.requiresStage) ctx.addIssue({ code: "custom", path: ["requiresStage"], message: "Choose a prerequisite stage" });
  if (row.entry === "direct" && row.requiresStage) ctx.addIssue({ code: "custom", path: ["requiresStage"], message: "Direct entry cannot require a stage" });
  const { eventStart: start, eventEnd: end } = row;
  if (start && end) {
    const day = (v: string) => v.includes("T") && row.timeZone ? dateAt(new Date(v), row.timeZone) : v.slice(0, 10);
    const reversed = start.includes("T") && end.includes("T") ? Date.parse(start) >= Date.parse(end) : day(start) > day(end);
    if (reversed) ctx.addIssue({ code: "custom", path: ["eventEnd"], message: "End must follow the start" });
  }
});
export const externalInput = z.strictObject({
  title: text, domain: text,
  eventUrl: z.url({ protocol: /^https?$/ }).max(2048).nullable(),
  stage: stageInput,
});
export type PrivateStage = z.output<typeof stageInput> & { key: string };
type Snapshot = { title: string; domain: string; eventUrl: string | null; stages: PrivateStage[] };
export type Progress = {
  application: "not-submitted" | "submitted"; decision: "pending" | "accepted" | "rejected";
  intent: "undecided" | "going" | "declined"; attended: number; result: "none" | "advanced" | "placed" | "won";
};
export type TrackedStage = PrivateStage & Progress & { unavailable: boolean };
export type PrivateEntry = {
  id: string; catalogId: string | null; title: string; domain: string; eventUrl: string | null;
  stages: TrackedStage[]; unavailable: boolean;
};
const defaults: Progress = {
  application: "not-submitted", decision: "pending", intent: "undecided", attended: 0, result: "none",
};

function fromCatalog(listing: Awaited<ReturnType<typeof publicCatalog>>[number]): Snapshot {
  return {
    title: listing.title, domain: listing.topics[0] ?? "Uncategorized", eventUrl: listing.eventUrl,
    stages: listing.stages.map((stage) => ({
      key: stage.key, name: stage.name ?? listing.title, entry: stage.entry, requiresStage: stage.requiresStage,
      eventStart: stage.eventStart, eventEnd: stage.eventEnd, timeZone: stage.timeZone, format: stage.format,
      // An online program window does not by itself establish required attendance.
      fixedAttendance: stage.format === "in-person" || stage.format === "hybrid",
    })),
  };
}

export async function privateEntries(db: Database, userId: string, now = new Date(), id?: string): Promise<PrivateEntry[]> {
  const rows = (await db.prepare(`SELECT id, catalog_id, snapshot FROM private_entries
    WHERE user_id = ? AND (? IS NULL OR id = ?) ORDER BY created_at, id`)
    .bind(userId, id ?? null, id ?? null).all<{ id: string; catalog_id: string | null; snapshot: string }>()).results;
  const result: PrivateEntry[] = [];
  for (const row of rows) {
    const saved = JSON.parse(row.snapshot) as Snapshot;
    const current = row.catalog_id ? (await publicCatalog(db, "all", { id: row.catalog_id, now }))[0] : null;
    const facts = current ? fromCatalog(current) : saved;
    const states = (await db.prepare(`SELECT stage_key, facts, application, decision, intent, attended, result
      FROM private_stage_progress WHERE entry_id = ? AND user_id = ? ORDER BY rowid`)
      .bind(row.id, userId).all<Progress & { stage_key: string; facts: string }>()).results;
    const externalStages = states.map((state) => JSON.parse(state.facts) as PrivateStage);
    const stages = row.catalog_id ? [...facts.stages] : externalStages;
    for (const state of states) if (!stages.some((stage) => stage.key === state.stage_key)) {
      stages.push(JSON.parse(state.facts) as PrivateStage);
    }
    result.push({
      id: row.id, catalogId: row.catalog_id, ...facts, unavailable: Boolean(row.catalog_id && !current),
      stages: stages.map((stage) => {
        const state = states.find((state) => state.stage_key === stage.key);
        return {
          ...stage, ...defaults, ...(state ? {
            application: state.application, decision: state.decision, intent: state.intent,
            attended: state.attended, result: state.result,
          } : {}),
          unavailable: Boolean(row.catalog_id && (!current || !facts.stages.some((item) => item.key === stage.key))),
        };
      }),
    });
  }
  return result;
}

export async function saveCatalog(db: Database, userId: string, catalogId: string, now = new Date()) {
  const [listing] = await publicCatalog(db, "all", { id: catalogId, now });
  if (!listing) return null;
  const snapshot = fromCatalog(listing), id = randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO private_entries (id, user_id, catalog_id, snapshot, created_at)
      VALUES (?, ?, ?, ?, ?)`).bind(id, userId, catalogId, JSON.stringify(snapshot), now.toISOString()),
    ...snapshot.stages.map((stage) => db.prepare(`INSERT OR IGNORE INTO private_stage_progress
      (entry_id, user_id, stage_key, facts) SELECT id, user_id, ?, ? FROM private_entries WHERE id = ? AND user_id = ?`)
      .bind(stage.key, JSON.stringify(stage), id, userId)),
  ]);
  return db.prepare("SELECT id FROM private_entries WHERE user_id = ? AND catalog_id = ?")
    .bind(userId, catalogId).first<string>("id");
}

export async function addExternal(db: Database, userId: string, input: unknown, now = new Date()) {
  const row = externalInput.parse(input), id = randomUUID();
  if (row.stage.entry !== "direct") throw new Error("The first stage must be direct entry");
  const stage: PrivateStage = { ...row.stage, key: randomUUID() };
  const snapshot: Snapshot = { title: row.title, domain: row.domain, eventUrl: row.eventUrl, stages: [] };
  await db.batch([
    db.prepare("INSERT INTO private_entries (id, user_id, snapshot, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, userId, JSON.stringify(snapshot), now.toISOString()),
    db.prepare("INSERT INTO private_stage_progress (entry_id, user_id, stage_key, facts) VALUES (?, ?, ?, ?)")
      .bind(id, userId, stage.key, JSON.stringify(stage)),
  ]);
  return id;
}

export async function changeExternalStage(db: Database, userId: string, id: string, input: unknown, key?: string) {
  const [entry] = await privateEntries(db, userId, new Date(), id);
  if (!entry || entry.catalogId) return false;
  const facts = stageInput.parse(input);
  const previous = entry.stages.find((stage) => stage.key === key);
  if (key && !previous) return false;
  if (facts.requiresStage && !entry.stages.some((stage) => stage.key === facts.requiresStage && stage.key !== key)) {
    throw new Error("Unknown prerequisite stage");
  }
  // Refer only to an earlier stage: this also prevents progression cycles.
  if (key && facts.requiresStage && entry.stages.findIndex((stage) => stage.key === facts.requiresStage)
    >= entry.stages.findIndex((stage) => stage.key === key)) throw new Error("Prerequisite must be earlier");
  const stage = { ...facts, key: key ?? randomUUID() };
  const result = await db.prepare(`INSERT INTO private_stage_progress (entry_id, user_id, stage_key, facts)
    SELECT id, user_id, ?, ? FROM private_entries WHERE id = ? AND user_id = ? AND catalog_id IS NULL
    ON CONFLICT (entry_id, stage_key) DO UPDATE SET facts = excluded.facts`)
    .bind(stage.key, JSON.stringify(stage), id, userId).run();
  return result.meta.changes === 1;
}

export const progressValues = {
  application: ["not-submitted", "submitted"],
  decision: ["pending", "accepted", "rejected"],
  intent: ["undecided", "going", "declined"],
  attended: ["0", "1"],
  result: ["none", "advanced", "placed", "won"],
} as const;
const progressInput=z.strictObject({application:z.enum(progressValues.application),decision:z.enum(progressValues.decision),intent:z.enum(progressValues.intent),
  attended:z.enum(progressValues.attended).transform(Number),result:z.enum(progressValues.result)});
export function stageVersion(stage:TrackedStage){
  const {key,name,eventStart,eventEnd,timeZone,format,entry,requiresStage,fixedAttendance,application,decision,intent,attended,result}=stage;
  return createHash("sha256").update(JSON.stringify({key,name,eventStart,eventEnd,timeZone,format,entry,requiresStage,fixedAttendance,application,decision,intent,attended,result})).digest("hex");
}
export async function savePrivateStage(db:Database,userId:string,id:string,key:string,version:string,input:unknown,factsInput:unknown|undefined,now=new Date()){
  const [entry]=await privateEntries(db,userId,now,id),stage=entry?.stages.find((item)=>item.key===key);
  if(!entry||!stage)return "missing" as const;
  if(stageVersion(stage)!==version)return "stale" as const;
  const state=progressInput.parse(input);
  const facts=entry.catalogId?stage:stageInput.parse(factsInput);
  if(!entry.catalogId&&facts.requiresStage){
    const index=entry.stages.findIndex((item)=>item.key===key),prior=entry.stages.findIndex((item)=>item.key===facts.requiresStage);
    if(prior<0||prior>=index)throw new Error("Prerequisite must be earlier");
  }
  const stored=await db.prepare("SELECT facts,application,decision,intent,attended,result FROM private_stage_progress WHERE entry_id=? AND user_id=? AND stage_key=?")
    .bind(id,userId,key).first<Progress & {facts:string}>();
  const current=stored??defaults;
  const row=await db.prepare(`INSERT INTO private_stage_progress(entry_id,user_id,stage_key,facts,application,decision,intent,attended,result)
    SELECT id,user_id,?,?,?,?,?,?,? FROM private_entries WHERE id=? AND user_id=?
    ON CONFLICT(entry_id,stage_key) DO UPDATE SET facts=excluded.facts,application=excluded.application,decision=excluded.decision,
      intent=excluded.intent,attended=excluded.attended,result=excluded.result
    WHERE private_stage_progress.facts=? AND private_stage_progress.application=? AND private_stage_progress.decision=?
      AND private_stage_progress.intent=? AND private_stage_progress.attended=? AND private_stage_progress.result=?`)
    .bind(key,entry.catalogId?(stored?.facts??JSON.stringify(stage)):JSON.stringify({...facts,key}),state.application,state.decision,state.intent,state.attended,state.result,
      id,userId,stored?.facts??"",current.application,current.decision,current.intent,current.attended,current.result).run();
  return row.meta.changes===1?"saved" as const:"stale" as const;
}
export async function updateProgress(
  db: Database, userId: string, id: string, key: string, field: string, value: string, now = new Date(),
) {
  if (!Object.hasOwn(progressValues, field)
    || !(progressValues[field as keyof typeof progressValues] as readonly string[]).includes(value)) {
    throw new Error("Invalid tracking value");
  }
  const [entry] = await privateEntries(db, userId, now, id);
  const stage = entry?.stages.find((stage) => stage.key === key);
  if (!stage) return false;
  // Only the named dimension is updated; concurrent forms cannot erase other progress.
  const result = await db.prepare(`INSERT INTO private_stage_progress (entry_id, user_id, stage_key, facts, ${field})
    SELECT id, user_id, ?, ?, ? FROM private_entries WHERE id = ? AND user_id = ?
    ON CONFLICT (entry_id, stage_key) DO UPDATE SET ${field} = excluded.${field}`)
    .bind(key, JSON.stringify(stage), field === "attended" ? Number(value) : value, id, userId).run();
  return result.meta.changes === 1;
}
