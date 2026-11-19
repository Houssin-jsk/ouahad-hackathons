import { z } from "zod";

const label = z.string().trim().min(1);
const key = label.regex(/^[a-z][a-z0-9-]*$/);
const url = z.url({ protocol: /^https?$/ });
const instant = z.iso.datetime({ offset: true }).refine(
  (value) => Number.isFinite(Date.parse(value)), "Invalid timestamp",
);
const zone = label.refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return !/^[+-]/.test(value);
  } catch { return false; }
}, "Expected a named time zone");

// Preserve the precision supplied by the organizer.
const dateValue = z.union([z.iso.date(), instant]);
const eligibility = z.strictObject({
  status: z.enum(["confirmed", "excluded", "unknown"]),
  note: label.optional(),
}).refine((value) => value.status === "unknown" || value.note, "Eligibility requires evidence");

const review = z.strictObject({
  url,
  checkedAt: instant,
});
const category = z.enum(["morocco", "international-online"]);
const format = z.enum(["in-person", "online", "hybrid", "unknown"]);
const timingAndEntry = z.strictObject({
  city: label.nullable(),
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
  eventStart: dateValue.nullable(),
  eventEnd: dateValue.nullable(),
  registrationDeadline: dateValue.nullable(),
  submissionDeadline: dateValue.nullable(),
  submissionDeadlineNote: label.nullable(),
  timeZone: zone.nullable(),
  applicationUrl: url.nullable(),
  rulesUrl: url.nullable(),
  registrationStatus: z.enum(["open", "closed", "unknown"]),
  registrationNote: label.nullable(),
  moroccoEligibility: eligibility,
});
const stageInput = timingAndEntry.partial().extend({
  key: key.refine((value) => value !== "window", "The key 'window' is reserved"),
  name: label,
  entry: z.enum(["direct", "advancement"]),
  requiresStage: key.optional(),
  evidenceUrl: url,
  category: category.optional(),
  format: format.optional(),
  onlineFromMorocco: z.boolean().optional(),
});
// Summaries are editorial facts in the same proposed/approved snapshot, never a public side channel.
const localizedSummary = z.strictObject({
  text: label.max(600), sourceUrl: url,
  method: z.enum(["manual", "generated-draft"]),
});
const details = timingAndEntry.extend({
  summaries: z.strictObject({ en: localizedSummary.optional(), fr: localizedSummary.optional(), ar: localizedSummary.optional() }).optional(),
  organizer: label.optional(),
  topics: z.array(label),
  review: review.nullable(),
  stages: z.array(stageInput).min(1).optional(),
  onlineFromMorocco: z.boolean().optional(),
});
const defaults = {
  city: null, countryCode: null, topics: [], eventStart: null, eventEnd: null,
  registrationDeadline: null, submissionDeadline: null, submissionDeadlineNote: null,
  timeZone: null, applicationUrl: null, rulesUrl: null, registrationStatus: "unknown",
  registrationNote: null, moroccoEligibility: { status: "unknown" }, review: null,
} satisfies z.input<typeof details>;

export function dateAt(time: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(time);
  const part = (kind: string) => parts.find(({ type }) => type === kind)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const sourceKey = z.strictObject({ source: key, externalId: label });
export const reviewRow = sourceKey.extend({
  facts: details.extend({ category, format }).partial().extend({ review }),
});
export const manualRow = details.partial().extend({
  category,
  format,
  source: key,
  externalId: label,
  title: label,
  eventUrl: url,
  review,
});

const observation = details.extend({
  category,
  format,
  title: label,
  eventUrl: url,
  provenance: sourceKey.extend({
    method: z.enum(["automatic", "manual"]),
    url,
    checkedAt: instant,
  }),
});

function validate(row: z.output<typeof observation>, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => {
    ctx.addIssue({ code: "custom", path: [path], message });
  };
  validateWindow(row, Boolean(row.review), issue);
  if (row.stages) {
    if (!row.review) issue("review", "Named stages require organizer review");
    const seen = new Set<string>();
    for (const [index, stage] of row.stages.entries()) {
      const stageIssue = (path: string, message: string) => {
        ctx.addIssue({ code: "custom", path: ["stages", index, path], message });
      };
      if (seen.has(stage.key)) stageIssue("key", "Duplicate stage key");
      if (stage.entry === "advancement" && (!stage.requiresStage || !seen.has(stage.requiresStage))) {
        stageIssue("requiresStage", "An advancement stage must name an earlier stage");
      }
      if (stage.entry === "direct" && stage.requiresStage) {
        stageIssue("requiresStage", "A direct entry stage cannot have a prerequisite");
      }
      seen.add(stage.key);
      validateWindow(stageWindow(row, stage), Boolean(row.review), stageIssue);
    }
  }
}

type Window = z.output<typeof timingAndEntry> & {
  category: z.output<typeof category>;
  format: z.output<typeof format>;
  onlineFromMorocco: boolean;
};

function validateWindow(
  row: Omit<Window, "onlineFromMorocco"> & { onlineFromMorocco?: boolean }, reviewed: boolean,
  issue: (path: string, message: string) => void,
) {
  if (row.category === "morocco" && row.countryCode !== "MA") {
    issue("countryCode", "A Morocco listing must be held in Morocco");
  }
  if ((row.category === "international-online" || row.onlineFromMorocco)
    && !["online", "hybrid"].includes(row.format)) {
    issue("format", "An international route must have an online option");
  }
  if (row.onlineFromMorocco && row.moroccoEligibility.status !== "confirmed") {
    issue("onlineFromMorocco", "An additional international route needs confirmed eligibility");
  }
  if (row.moroccoEligibility.status !== "unknown" && !reviewed) {
    issue("review", "A verified eligibility decision requires a source and time");
  }
  if (row.registrationStatus !== "unknown" && (!reviewed || !row.registrationNote)) {
    issue("registrationNote", "A known registration status requires a review and evidence note");
  }
  const { eventStart: start, eventEnd: end } = row;
  if (start && end) {
    const zone = row.timeZone;
    const comparable = (value: string) => value.includes("T") && zone
      ? dateAt(new Date(value), zone) : value.slice(0, 10);
    const reversed = start.includes("T") && end.includes("T")
      ? Date.parse(start) > Date.parse(end)
      : !zone && start.includes("T") !== end.includes("T")
        ? false : comparable(start) > comparable(end);
    if (reversed) issue("eventEnd", "Event end precedes its start");
  }
}

function stageWindow(row: z.output<typeof observation>, stage?: z.output<typeof stageInput>): Window {
  // Named stages can inherit the edition venue/links, but not its dates or entry status.
  return {
    category: stage?.category ?? row.category,
    format: stage?.format ?? row.format,
    onlineFromMorocco: Boolean(stage ? stage.onlineFromMorocco : row.onlineFromMorocco),
    city: stage?.city === undefined ? row.city : stage.city,
    countryCode: stage?.countryCode === undefined ? row.countryCode : stage.countryCode,
    timeZone: stage?.timeZone === undefined ? row.timeZone : stage.timeZone,
    eventStart: stage ? stage.eventStart ?? null : row.eventStart,
    eventEnd: stage ? stage.eventEnd ?? null : row.eventEnd,
    registrationDeadline: stage ? stage.registrationDeadline ?? null : row.registrationDeadline,
    submissionDeadline: stage ? stage.submissionDeadline ?? null : row.submissionDeadline,
    submissionDeadlineNote: stage ? stage.submissionDeadlineNote ?? null : row.submissionDeadlineNote,
    applicationUrl: stage?.applicationUrl === undefined ? row.applicationUrl : stage.applicationUrl,
    rulesUrl: stage?.rulesUrl === undefined ? row.rulesUrl : stage.rulesUrl,
    registrationStatus: stage ? stage.registrationStatus ?? "unknown" : row.registrationStatus,
    registrationNote: stage ? stage.registrationNote ?? null : row.registrationNote,
    moroccoEligibility: stage ? stage.moroccoEligibility ?? { status: "unknown" } : row.moroccoEligibility,
  };
}

export type Observation = z.output<typeof observation>;
export type Candidate = Omit<z.input<typeof observation>, keyof typeof defaults>
  & Partial<z.input<typeof details>>;
export type ManualRow = z.output<typeof manualRow>;
export type ReviewRow = z.output<typeof reviewRow>;

export const opportunity = observation.extend({
  id: label,
  publication: z.literal("draft"),
  firstImportedAt: instant,
}).superRefine(validate).refine((row) => row.id === identity(row.provenance), {
  path: ["id"], message: "ID does not match provenance",
});
export type Opportunity = z.output<typeof opportunity>;

export type EventStage = Window & {
  key: string;
  name: string | null;
  entry: "direct" | "advancement";
  requiresStage: string | null;
  evidenceUrl: string;
};

export function eventStages(row: Opportunity): EventStage[] {
  if (!row.stages) return [{
    key: "window", name: null, entry: "direct", requiresStage: null,
    evidenceUrl: row.review?.url ?? row.provenance.url, ...stageWindow(row),
  }];
  return row.stages.map((stage) => ({
    key: stage.key, name: stage.name, entry: stage.entry, requiresStage: stage.requiresStage ?? null,
    evidenceUrl: stage.evidenceUrl, ...stageWindow(row, stage),
  }));
}

export function identity({ source, externalId }: z.output<typeof sourceKey>): string {
  return `${source}:${encodeURIComponent(externalId)}`;
}

export function normalize(input: Candidate, now: string): Opportunity {
  const candidate = { ...defaults, ...input };
  return opportunity.parse({
    ...candidate, id: identity(input.provenance), publication: "draft", firstImportedAt: now,
  });
}

export function elapsed(value: string | null, timeZone: string | null, now: Date): boolean {
  if (!value) return false;
  if (value.includes("T")) return now.getTime() >= Date.parse(value);
  // If no zone is published, wait until the day has passed in every time zone.
  return dateAt(now, timeZone ?? "Etc/GMT+12") > value;
}

export function statusAt(row: Opportunity, now = new Date()) {
  return elapsed(row.eventEnd, row.timeZone, now)
    || elapsed(row.registrationDeadline, row.timeZone, now)
    ? "expired" : row.registrationStatus;
}
