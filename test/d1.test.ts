import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { publicCatalog } from "../src/catalog-read.ts";
import {
  decideRevision, importIntoD1, inspectEdition, pendingReviews, sourceQueue, withdrawEdition,
} from "../src/catalog-write.ts";
import { migrate, openLocalD1 } from "../src/local-d1.ts";
import { phase1Sources } from "../src/phase1-seed.ts";
import { automaticSources, loadReviews, manualSource } from "../src/sources.ts";

const clock = new Date("2026-11-17T16:00:00Z");
const addId = "add-open-data:hackathon-open-data-2026";
const techId = "ibn-zohr-fsa:technovate-blue-tech-2026";
const radishId = "hack-club:recDFXvSpx4603YEa";
const waterId = "uca-rss:https%3A%2F%2Fcim.uca.ma%2F%3Fp%3D5562";

async function setup(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "ouahad-d1-"));
  const persistence = join(folder, "d1");
  const { db, close } = await openLocalD1(persistence);
  t.after(async () => {
    await close();
    await rm(folder, { recursive: true, force: true });
  });
  assert.deepEqual(await migrate(db), ["0001_catalog.sql", "0002_sync.sql", "0003_private.sql", "0004_provider_auth.sql", "0005_local_email_codes.sql", "0006_stage_reminders.sql", "0007_transactional_email.sql"]);
  assert.deepEqual(await migrate(db), []);
  return { db, folder, persistence };
}

test("local D1 stores ten stable drafts; publishing only the inspected revision exposes one edition", async (t) => {
  const { db, persistence } = await setup(t);
  const sources = await phase1Sources();
  const first = await importIntoD1(db, sources, { now: clock, seedOnly: true });
  assert.deepEqual(first.totals, { editions: 10, drafts: 10, published: 0 });
  const reviews = await pendingReviews(db);
  assert.equal(reviews.length, 10);
  for (const view of ["all", "open", "archive"] as const) {
    assert.deepEqual(await publicCatalog(db, view, { now: clock }), []);
  }
  const countSql = `SELECT (SELECT count(*) FROM competitions) AS competitions,
    (SELECT count(*) FROM stages WHERE stage_key = 'window' AND name IS NULL) AS stages,
    (SELECT count(*) FROM source_evidence WHERE edition_id IS NOT NULL) AS sources,
    (SELECT count(*) FROM edition_revisions) AS revisions`;
  assert.deepEqual(await db.prepare(countSql).first(), { competitions: 10, stages: 10, sources: 10, revisions: 10 });
  // Replay the regular import path as well as the seed path.
  await importIntoD1(db, sources, { now: new Date("2026-11-18T16:00:00Z") });
  assert.deepEqual(await pendingReviews(db), reviews);
  assert.deepEqual(await db.prepare(countSql).first(), { competitions: 10, stages: 10, sources: 10, revisions: 10 });

  const add = await inspectEdition(db, addId);
  assert.ok(add.pendingId);
  assert.equal(add.pending?.facts.review?.checkedAt, "2026-11-17T14:24:00Z");
  assert.equal(add.pending?.stages[0]?.registrationDeadline, "2026-11-20T16:30:00+01:00");
  assert.equal(add.pending?.stages[0]?.submissionDeadline, null);
  assert.equal(add.pending?.stages[0]?.eventStart, "2026-12-21");
  await assert.rejects(decideRevision(db, "publish", addId, "wrong-revision", null, clock));
  assert.deepEqual(await publicCatalog(db, "all", { now: clock }), []);
  await decideRevision(db, "publish", addId, add.pendingId, null, clock);
  assert.deepEqual((await publicCatalog(db, "all", { now: clock })).map(({ id }) => id), [addId]);
  assert.deepEqual((await publicCatalog(db, "open", {
    now: new Date("2026-11-20T15:29:59Z"),
  })).map(({ id }) => id), [addId]);

  const deadline = new Date("2026-11-20T15:30:00Z");
  assert.deepEqual(await publicCatalog(db, "open", { now: deadline }), []);
  const [closed] = await publicCatalog(db, "archive", { now: deadline });
  assert.equal(closed?.id, addId);
  assert.equal(closed?.status, "applications-closed");
  const [finished] = await publicCatalog(db, "archive", { now: new Date("2026-12-23T00:00:00Z") });
  assert.equal(finished?.status, "finished");
  const after = await inspectEdition(db, addId);
  assert.equal(after.approvedId, add.pendingId);
  assert.equal(after.publicationState, "published");
  assert.deepEqual(after.actions.map(({ action }) => action), ["publish"]);

  const tech = await inspectEdition(db, techId);
  assert.ok(tech.pendingId);
  await decideRevision(db, "reject", techId, tech.pendingId, "Needs clearer evidence", clock);
  await importIntoD1(db, sources, { now: clock });
  assert.equal((await inspectEdition(db, techId)).publicationState, "rejected");
  assert.equal((await inspectEdition(db, techId)).pendingId, null);
  const water = await inspectEdition(db, waterId);
  assert.ok(water.pendingId);
  await decideRevision(db, "publish", waterId, water.pendingId, null, clock);
  assert.deepEqual((await publicCatalog(db, "archive", { now: clock })).map(({ id }) => id), [waterId]);
  await withdrawEdition(db, addId, "Owner removed the listing", clock);
  await importIntoD1(db, sources, { now: clock });
  assert.deepEqual((await publicCatalog(db, "all", { now: clock })).map(({ id }) => id), [waterId]);
  assert.equal((await inspectEdition(db, addId)).publicationState, "withdrawn");

  const reopened = await openLocalD1(persistence);
  try {
    assert.deepEqual((await publicCatalog(reopened.db, "all", { now: clock })).map(({ id }) => id), [waterId]);
  } finally {
    await reopened.close();
  }
});

test("local D1 queues automated changes without replacing approval, including across failed or missing feeds", async (t) => {
  const { db } = await setup(t);
  const sources = await phase1Sources();
  await importIntoD1(db, sources, { now: clock, seedOnly: true });
  const original = await inspectEdition(db, radishId);
  assert.ok(original.pendingId);
  await decideRevision(db, "publish", radishId, original.pendingId, null, clock);
  const publicBefore = await publicCatalog(db, "archive", { now: clock, audience: "international-online" });
  assert.equal(publicBefore[0]?.title, "Radish Jam");
  assert.equal(publicBefore.length, 1);

  const reviews = await loadReviews("data/source-reviews.json");
  const api = JSON.parse(await readFile("test/fixtures/hack-club.json", "utf8"));
  api.data[0].name = "Radish Jam (proposed title)";
  api.data[0].endDate = "2026-07-11";
  api.data.push({ ...api.data[0], id: "new-discovery", name: "Unreviewed Jam" });
  api.meta.count = 3;
  let mode: "changed" | "offline" | "missing" = "changed";
  const online = automaticSources(reviews, async () => mode === "offline"
    ? new Response(null, { status: 503 })
    : Response.json(mode === "missing" ? { data: [], meta: { count: 0 } } : api),
  () => clock.toISOString())[1]!;
  await importIntoD1(db, [online], { now: clock });
  const proposed = await inspectEdition(db, radishId);
  assert.ok(proposed.pendingId);
  assert.equal(proposed.pending?.facts.title, "Radish Jam (proposed title)");
  assert.equal(proposed.pending?.stages[0]?.eventEnd, "2026-07-11");
  assert.equal(proposed.approved?.stages[0]?.eventEnd, "2026-07-10");
  assert.equal(proposed.pending?.facts.review?.checkedAt, original.pending?.facts.review?.checkedAt);
  assert.deepEqual(await publicCatalog(db, "archive", { now: clock, audience: "international-online" }), publicBefore);
  assert.equal((await sourceQueue(db)).candidates[0]?.externalId, "new-discovery");

  mode = "offline";
  assert.equal((await importIntoD1(db, [online], { now: clock })).sources[0]?.ok, false);
  assert.match(String((await sourceQueue(db)).health[0]?.error), /503/);
  mode = "missing";
  await importIntoD1(db, [online], { now: clock });
  assert.ok((await sourceQueue(db)).health[0]?.missing_reviewed_ids.includes("recDFXvSpx4603YEa"));
  assert.deepEqual(await publicCatalog(db, "archive", { now: clock, audience: "international-online" }), publicBefore);

  mode = "changed";
  api.data[0].name = "Radish Jam (newer proposal)";
  await importIntoD1(db, [online], { now: clock });
  await assert.rejects(decideRevision(db, "publish", radishId, proposed.pendingId!, null, clock));
  const latest = await inspectEdition(db, radishId);
  assert.ok(latest.pendingId);
  await decideRevision(db, "reject", radishId, latest.pendingId, null, clock);
  assert.deepEqual(await publicCatalog(db, "archive", { now: clock, audience: "international-online" }), publicBefore);
  await importIntoD1(db, [online], { now: clock });
  assert.equal((await inspectEdition(db, radishId)).pendingId, null);
  api.data[0].name = "Radish Jam (verified correction)";
  await importIntoD1(db, [online], { now: clock });
  const correction = await inspectEdition(db, radishId);
  assert.ok(correction.pendingId);
  await decideRevision(db, "publish", radishId, correction.pendingId, null, clock);
  const [published] = await publicCatalog(db, "archive", { now: clock });
  assert.equal(published?.title, "Radish Jam (verified correction)");
  assert.equal(published?.stages[0]?.eventEnd, "2026-07-11");
});

test("local D1 reads multi-stage entries, audiences and date-only closure without guessing from submission dates", async (t) => {
  const { db, folder } = await setup(t);
  const sample = {
    source: "local-test",
    externalId: "qualifier-example",
    title: "Example Qualifier and Final",
    category: "morocco",
    format: "hybrid",
    countryCode: "MA",
    timeZone: "Africa/Casablanca",
    eventUrl: "https://example.org/event",
    review: { url: "https://example.org/rules", checkedAt: clock.toISOString() },
    stages: [
      {
        key: "qualifier", name: "Qualifier", entry: "direct",
        eventStart: "2026-11-22", eventEnd: "2026-11-22", registrationDeadline: "2026-11-19",
        submissionDeadline: "2026-11-18T16:00:00Z", evidenceUrl: "https://example.org/qualifier",
        registrationStatus: "open", registrationNote: "Official form is open.",
        moroccoEligibility: { status: "confirmed", note: "Morocco entrants explicitly accepted." },
        onlineFromMorocco: true,
      },
      {
        key: "final", name: "Final", entry: "advancement", requiresStage: "qualifier",
        eventStart: "2026-11-27", eventEnd: "2026-11-27", evidenceUrl: "https://example.org/final",
        registrationStatus: "open", registrationNote: "Qualifiers can confirm directly.",
      },
    ],
  };
  const path = join(folder, "input.json");
  await writeFile(path, JSON.stringify([sample]));
  const report = await importIntoD1(db, [manualSource(path)], { now: clock });
  assert.equal(report.sources[0]?.ok, true);
  const id = "local-test:qualifier-example";
  const record = await inspectEdition(db, id);
  assert.ok(record.pendingId);
  await decideRevision(db, "publish", id, record.pendingId, null, clock);
  const before = new Date("2026-11-19T22:59:59Z");
  for (const audience of ["morocco", "international-online"] as const) {
    assert.deepEqual((await publicCatalog(db, "open", { now: before, audience })).map((row) => row.id), [id]);
  }
  const cutoff = new Date("2026-11-19T23:00:00Z");
  assert.deepEqual(await publicCatalog(db, "open", { now: cutoff }), []);
  const [archived] = await publicCatalog(db, "archive", { now: cutoff });
  assert.equal(archived?.status, "applications-closed");
  assert.deepEqual(archived?.stages.map(({ key, status }) => [key, status]), [
    ["qualifier", "closed"], ["final", "open"],
  ]);
});
