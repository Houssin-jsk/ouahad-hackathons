import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";
import { migrate, openLocalD1 } from "../src/local-d1.ts";
import { importIntoD1, inspectEdition, decideRevision } from "../src/catalog-write.ts";
import { publicCatalog } from "../src/catalog-read.ts";
import { phase1Sources } from "../src/phase1-seed.ts";
import { manualSource } from "../src/sources.ts";
import { addExternal, changeExternalStage, privateEntries, saveCatalog, updateProgress } from "../src/private/entries.ts";
import { conflicts, privateProgress } from "../src/private/conflicts.ts";
import { newSession } from "../src/private/session.ts";
import { listenCatalog } from "../src/web/server.ts";

const clock = new Date("2026-11-17T17:00:00Z");
const add = "add-open-data:hackathon-open-data-2026";
const stage = {
  name: "Regional qualifier", eventStart: "2026-12-01T09:00:00+01:00", eventEnd: "2026-12-01T17:00:00+01:00",
  timeZone: "Africa/Casablanca", format: "in-person", entry: "direct", requiresStage: null, fixedAttendance: true,
};
async function setup(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "ouahad-private-"));
  const runtime = await openLocalD1(join(folder, "d1"));
  await migrate(runtime.db);
  const seed = await importIntoD1(runtime.db, await phase1Sources(), { now: clock, seedOnly: true });
  assert.equal(seed.totals?.drafts, 10);
  t.after(async () => { await runtime.close(); await rm(folder, { recursive: true, force: true }); });
  return { db: runtime.db, folder };
}

test("local accounts enforce sessions, CSRF, ownership, and private/public separation through HTTP", async (t) => {
  const { db } = await setup(t);
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const server = await listenCatalog(db, { port: 0, now: () => clock, developmentAuth: true });
  process.env.NODE_ENV = prior;
  t.after(server.close);
  const get = (path: string, cookie = "") => fetch(server.url + path, { headers: { Cookie: cookie }, redirect: "manual" });
  const post = (path: string, cookie: string, values: Record<string, string>, origin = server.url) => fetch(server.url + path, {
    method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: origin }, body: new URLSearchParams(values),
  });
  async function login(identity: string) {
    const start = await get("/sign-in");
    const preCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(await start.text())![1]!;
    const response = await post("/sign-in", preCookie, { csrf, identity, next: "//evil.example/my" });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/my");
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    assert.notEqual(cookie, preCookie);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
    assert.equal((await get("/my", preCookie)).status, 303);
    const page = await get("/my", cookie);
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    const token = /name="csrf" value="([a-f0-9]+)"/.exec(await page.text())![1]!;
    return { cookie, csrf: token };
  }
  assert.equal((await get("/")).status, 200);
  assert.equal((await get("/my")).status, 303);
  assert.equal((await get("/my", "ouahad_dev_session=" + "a".repeat(64))).status, 303);
  const aya = await login("dev-aya"), sami = await login("dev-sami");
  const body = { csrf: aya.csrf, title: "Private robotics challenge", domain: "robotics", eventUrl: "https://example.org",
    ...Object.fromEntries(Object.entries(stage).map(([key, value]) => [key, value === null ? "" : String(value)])), fixedAttendance: "1" };
  assert.equal((await post("/my/new", aya.cookie, { ...body, csrf: "wrong" })).status, 403);
  assert.equal((await post("/my/new", aya.cookie, body, "https://evil.example")).status, 403);
  assert.equal((await post("/my/new", aya.cookie, body, "")).status, 403);
  assert.equal((await post("/my/new", aya.cookie, { ...body, user_id: "dev-sami" })).status, 400);
  const created = await post("/my/new", aya.cookie, body);
  assert.equal(created.status, 303);
  const path = created.headers.get("location")!;
  assert.equal((await get(path, aya.cookie)).status, 200);
  assert.equal((await get(path, sami.cookie)).status, 404);
  const entries = await privateEntries(db, "dev-aya", clock);
  const key = entries[0]!.stages[0]!.key;
  const progress = { csrf: sami.csrf, stage: key, field: "decision", value: "accepted" };
  assert.equal((await post(path + "/progress", sami.cookie, progress)).status, 404);
  assert.equal((await post(path + "/stages/" + key, sami.cookie, { ...body, csrf: sami.csrf })).status, 404);
  assert.equal((await post(path + "/stages", sami.cookie, { ...body, csrf: sami.csrf })).status, 404);
  assert.equal((await privateEntries(db, "dev-aya", clock))[0]!.stages[0]!.decision, "pending");
  assert.deepEqual(await privateEntries(db, "dev-sami", clock), []);
  assert.equal((await post("/my/save", aya.cookie, { csrf: aya.csrf, editionId: add })).status, 404);
  const reviewed = await inspectEdition(db, add);
  await decideRevision(db, "publish", add, reviewed.pendingId!, null, clock);
  const firstSave = await post("/my/save", aya.cookie, { csrf: aya.csrf, editionId: add });
  const secondSave = await post("/my/save", aya.cookie, { csrf: aya.csrf, editionId: add });
  assert.equal(firstSave.headers.get("location"), secondSave.headers.get("location"));
  await get(`/hackathons/${encodeURIComponent(add)}`, aya.cookie);
  const saved = (await privateEntries(db, "dev-aya", clock)).find((row) => row.catalogId)!;
  assert.equal(saved.stages[0]!.application, "not-submitted");
  assert.deepEqual((await publicCatalog(db, "all", { now: clock })).map((row) => row.id), [add]);
  assert.doesNotMatch(await (await get("/")).text(), /Private robotics/);
  assert.equal((await get("/hackathons/" + entries[0]!.id)).status, 404);
  const stale = await newSession(db, "dev-aya", new Date(clock.getTime() - 9 * 3600_000));
  assert.equal((await get("/my", stale.setCookie)).status, 303);
  assert.equal((await post("/sign-out", aya.cookie, { csrf: aya.csrf })).status, 303);
  assert.equal((await get("/my", aya.cookie)).status, 303);
  assert.equal((await post(path + "/progress", aya.cookie, { ...progress, csrf: aya.csrf })).status, 401);
  // Even an explicit auth flag cannot enable local identities in production.
  process.env.NODE_ENV = "production";
  const disabled = await listenCatalog(db, { port: 0, developmentAuth: true });
  process.env.NODE_ENV = prior;
  t.after(disabled.close);
  for (const method of ["GET", "POST"]) assert.equal((await fetch(disabled.url + "/sign-in", { method })).status, 404);
});

test("D1 stage progress and conflicts survive advancement, dates, declines and independent changes", async (t) => {
  const { db } = await setup(t);
  await newSession(db, "dev-aya", clock);
  const regional = await addExternal(db, "dev-aya", { title: "Private regional story", domain: "robotics", eventUrl: null, stage }, clock);
  let entry = (await privateEntries(db, "dev-aya", clock, regional))[0]!;
  const qualifier = entry.stages[0]!.key;
  await changeExternalStage(db, "dev-aya", regional, { ...stage, name: "National final", entry: "advancement", requiresStage: qualifier,
    eventStart: "2026-12-10T09:00:00+01:00", eventEnd: "2026-12-10T17:00:00+01:00" });
  const second = await addExternal(db, "dev-aya", { title: "Private second hackathon", domain: "robotics", eventUrl: null,
    stage: { ...stage, name: "Hackathon", eventStart: "2026-12-10T09:30:00Z", eventEnd: "2026-12-10T12:00:00Z" } }, clock);
  const secondKey = (await privateEntries(db, "dev-aya", clock, second))[0]!.stages[0]!.key;
  await updateProgress(db, "dev-aya", regional, qualifier, "application", "submitted", clock);
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock)).length, 0);
  await updateProgress(db, "dev-aya", second, secondKey, "application", "submitted", clock);
  let warning = conflicts(await privateEntries(db, "dev-aya", clock))[0]!;
  assert.equal(warning.kind, "confirmed");
  assert.equal(warning.a.conditional || warning.b.conditional, true);
  for (const [field, value] of [["decision", "accepted"], ["intent", "going"], ["attended", "1"], ["result", "advanced"]]) {
    await updateProgress(db, "dev-aya", regional, qualifier, field!, value!, clock);
  }
  entry = (await privateEntries(db, "dev-aya", clock, regional))[0]!;
  const final = entry.stages[1]!.key;
  assert.equal(entry.stages[1]!.decision, "pending", "Advancing is not automatic acceptance");
  await updateProgress(db, "dev-aya", regional, final, "decision", "accepted", clock);
  warning = conflicts(await privateEntries(db, "dev-aya", clock))[0]!;
  assert.equal(warning.a.conditional || warning.b.conditional, false);
  await updateProgress(db, "dev-aya", second, secondKey, "intent", "declined", clock);
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock)).length, 0);
  const summary = privateProgress(await privateEntries(db, "dev-aya", clock));
  assert.deepEqual(summary, { entries: 2, accepted: 1, attended: 1, stageAttendances: 1, advancements: 1, domains: [{ domain: "robotics", entries: 2, stageAttendances: 1, advancements: 1 }] });
  await updateProgress(db, "dev-aya", second, secondKey, "intent", "going", clock);
  await changeExternalStage(db, "dev-aya", second, { ...stage, name: "Date only", eventStart: "2026-12-10", eventEnd: "2026-12-10" }, secondKey);
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock))[0]!.kind, "possible");
  await changeExternalStage(db, "dev-aya", second, { ...stage, eventStart: "2026-12-11", eventEnd: "2026-12-11", timeZone: "Asia/Tokyo" }, secondKey);
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock))[0]!.kind, "possible", "Tokyo's next civil day starts before the final ends");
  await changeExternalStage(db, "dev-aya", second, { ...stage, eventStart: "2026-12-11", eventEnd: "2026-12-11" }, secondKey);
  assert.deepEqual(conflicts(await privateEntries(db, "dev-aya", clock)), [], "Morocco's next civil day does not overlap");
  await changeExternalStage(db, "dev-aya", second, { ...stage, eventStart: "2026-12-11", eventEnd: "2026-12-11", timeZone: null }, secondKey);
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock))[0]!.kind, "possible", "Unknown zones remain uncertain");
  await changeExternalStage(db, "dev-aya", second, { ...stage, eventStart: null, eventEnd: null }, secondKey);
  assert.deepEqual(conflicts(await privateEntries(db, "dev-aya", clock)), []);
  await changeExternalStage(db, "dev-aya", second, { ...stage, eventStart: "2026-12-10T16:00:00Z", eventEnd: "2026-12-10T18:00:00Z" }, secondKey);
  assert.deepEqual(conflicts(await privateEntries(db, "dev-aya", clock)), [], "Touching endpoints do not overlap");
  await changeExternalStage(db, "dev-aya", second, { ...stage, eventStart: "2026-12-10T09:00:00Z", eventEnd: "2026-12-10T18:00:00Z", format: "online", fixedAttendance: false }, secondKey);
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock))[0]!.kind, "possible", "An online window is not required attendance");
  assert.equal(await updateProgress(db, "dev-sami", regional, final, "decision", "accepted", clock), false);
  assert.equal(await changeExternalStage(db, "dev-sami", regional, stage, qualifier), false);
  assert.deepEqual(await publicCatalog(db, "all", { now: clock }), []);
});

test("saved entries use approved schedule changes only, preserving stage progress and ownership", async (t) => {
  const { db, folder } = await setup(t);
  await newSession(db, "dev-aya", clock);
  const file = join(folder, "synthetic.json");
  // Synthetic organizer facts exist only in this isolated test database, never the real catalog.
  const sample = { source: "local-test", externalId: "schedule", title: "Test schedule", category: "morocco", countryCode: "MA",
    format: "in-person", eventUrl: "https://example.org", review: { url: "https://example.org", checkedAt: clock.toISOString() },
    stages: [{ key: "main", name: "Main stage", entry: "direct", evidenceUrl: "https://example.org", eventStart: stage.eventStart, eventEnd: stage.eventEnd }] };
  async function importSample() { await writeFile(file, JSON.stringify([sample])); await importIntoD1(db, [manualSource(file)], { now: clock }); }
  async function approve() { const row = await inspectEdition(db, "local-test:schedule"); await decideRevision(db, "publish", "local-test:schedule", row.pendingId!, null, clock); }
  await importSample(); await approve();
  const saved = (await saveCatalog(db, "dev-aya", "local-test:schedule", clock))!;
  await updateProgress(db, "dev-aya", saved, "main", "application", "submitted", clock);
  const external = await addExternal(db, "dev-aya", { title: "Private same day", domain: "robotics", eventUrl: null, stage }, clock);
  const key = (await privateEntries(db, "dev-aya", clock, external))[0]!.stages[0]!.key;
  await updateProgress(db, "dev-aya", external, key, "application", "submitted", clock);
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock)).length, 1);
  sample.stages[0]!.eventStart = "2026-12-02T09:00:00+01:00";
  sample.stages[0]!.eventEnd = "2026-12-02T17:00:00+01:00";
  await importSample();
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock)).length, 1);
  await approve();
  assert.equal(conflicts(await privateEntries(db, "dev-aya", clock)).length, 0);
  const updated = (await privateEntries(db, "dev-aya", clock, saved))[0]!;
  assert.equal(updated.stages[0]!.eventStart, sample.stages[0]!.eventStart);
  assert.equal(updated.stages[0]!.application, "submitted");
  assert.deepEqual(await privateEntries(db, "dev-sami", clock), []);
});
