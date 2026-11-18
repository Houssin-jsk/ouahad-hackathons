import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { Response as RuntimeResponse } from "miniflare";
import { publicCatalog } from "../src/catalog-read.ts";
import { decideRevision, inspectEdition, pendingReviews, sourceQueue } from "../src/catalog-write.ts";
import { openLocalD1, migrate } from "../src/local-d1.ts";
import { openScheduledD1 } from "../src/local-scheduled.ts";
import { loadReviews } from "../src/sources.ts";
import { runDailySync, syncStatus, dailyCron, leaseMs } from "../src/sync.ts";
import { listenCatalog } from "../src/web/server.ts";
import { listingPath } from "../src/web/catalog-page.ts";
import { automaticSources, downloadText } from "../src/sources-automatic.ts";

const now = new Date("2026-11-18T10:00:00Z");
const clock = () => now;
const radish = "hack-club:recDFXvSpx4603YEa";

async function setup(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "ouahad-sync-"));
  const persist = join(folder, "d1");
  const runtime = await openLocalD1(persist);
  const fixtures = {
    rss: await readFile("test/fixtures/uca-rss.xml", "utf8"),
    api: await readFile("test/fixtures/hack-club.json", "utf8"),
    github: await readFile("test/fixtures/github-gaming-rss.xml", "utf8"),
  };
  await migrate(runtime.db);
  t.after(async () => {
    await runtime.close();
    await rm(folder, { recursive: true, force: true });
  });
  const reviews = await loadReviews("data/source-reviews.json");
  const response = (url: string) => url.includes("hackclub.com/") ? fixtures.api
    : url.includes("github.blog/") ? fixtures.github : fixtures.rss;
  const fetcher: typeof fetch = async (request) => new Response(response(String(request)));
  return { db: runtime.db, persist, fixtures, reviews, fetcher, response };
}

test("daily sync records new drafts, no-change successes, candidates and stable repeat IDs in local D1", async (t) => {
  const { db, reviews, fetcher } = await setup(t);
  const first = await runDailySync(db, { reviews, fetcher, clock, runId: "first" });
  assert.ok(first.sources.every(({ outcome }) => outcome === "success"));
  assert.equal(first.sources.reduce((n, r) => n + r.new_drafts, 0), 4);
  assert.equal(first.sources.reduce((n, r) => n + r.new_candidates, 0), 2);
  assert.deepEqual(await publicCatalog(db, "all", { now }), []);
  const initialQueue = await pendingReviews(db);
  assert.equal(initialQueue.length, 4);
  const second = await runDailySync(db, { reviews, fetcher, clock, runId: "second" });
  assert.equal(second.sources.reduce((n, r) => n + r.new_drafts + r.proposed_changes + r.new_candidates, 0), 0);
  assert.equal(second.sources.reduce((n, r) => n + r.unchanged_records, 0), 4);
  assert.ok(second.sources.every(({ outcome, finished_at, attempts }) => outcome === "success" && finished_at && attempts === 1));
  assert.deepEqual(await pendingReviews(db), initialQueue);
  const replay = await runDailySync(db, { reviews, fetcher: async () => { throw new Error("Should not fetch"); }, clock, runId: "first" });
  assert.equal(replay.replay, true);
  assert.deepEqual(await pendingReviews(db), initialQueue);
  const status = await syncStatus(db, now);
  assert.ok(status.sources.every(({ stale, lastSuccessAt }) => !stale && lastSuccessAt === now.toISOString()));
  const overridden = reviews.map((row) => row.externalId === "recDFXvSpx4603YEa"
    ? { ...row, facts: { ...row.facts, eventEnd: "2026-07-09" } } : row);
  await runDailySync(db, { reviews: overridden, fetcher, clock });
  assert.ok((await syncStatus(db, now)).sourceEvidenceDisagreements
    .some((row) => row.editionId === radish && row.field === "eventEnd"));
  assert.ok((await syncStatus(db, new Date(now.getTime() + 49 * 3600_000))).sources.every(({ stale }) => stale));
  const empty = await runDailySync(db, { reviews, clock, fetcher: async (request) =>
    String(request).includes("hackclub.com/") ? Response.json({ data: [], meta: { count: 0 } })
      : new Response("<rss><channel><title>Empty valid feed</title></channel></rss>"),
  });
  assert.ok(empty.sources.every(({ outcome, new_drafts, new_candidates, unchanged_records }) =>
    outcome === "success" && new_drafts === 0 && new_candidates === 0 && unchanged_records === 0));
  assert.equal((await pendingReviews(db)).length, 4);
  assert.equal((await syncStatus(db, now)).sources.find(({ source }) => source === "uca-rss")
    ?.missingReviewedIds.length, 2);
});

test("one source fails independently; a source change queues a proposal while the public page remains approved", async (t) => {
  const { db, reviews, fetcher, fixtures } = await setup(t);
  await runDailySync(db, { reviews, fetcher, clock });
  const draft = await inspectEdition(db, radish);
  assert.ok(draft.pendingId);
  await decideRevision(db, "publish", radish, draft.pendingId, null, now);
  const server = await listenCatalog(db, { port: 0, now: clock });
  t.after(() => server.close());
  const url = server.url + listingPath(radish);
  const before = await (await fetch(url)).text();
  const updated = JSON.parse(fixtures.api);
  updated.data[0].name = "Radish Jam — updated by source";
  const report = await runDailySync(db, {
    reviews, clock,
    fetcher: async (request) => String(request).includes("cim.uca.ma") ? new Response(null, { status: 503 })
      : String(request).includes("hackclub.com/") ? Response.json(updated) : new Response(fixtures.github),
  });
  const failed = report.sources.find(({ source }) => source === "uca-rss")!;
  const changed = report.sources.find(({ source }) => source === "hack-club")!;
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.attempts, 3);
  assert.match(failed.error!, /503/);
  assert.equal(changed.outcome, "success");
  assert.equal(changed.proposed_changes, 1);
  assert.equal(changed.unchanged_records, 1);
  const inspected = await inspectEdition(db, radish);
  assert.equal(inspected.approvedId, draft.pendingId);
  assert.equal(inspected.pending?.facts.title, updated.data[0].name);
  assert.equal(await (await fetch(url)).text(), before);
  assert.equal((await sourceQueue(db)).health.find(({ source }) => source === "uca-rss")?.error?.includes("503"), true);
  const status = await syncStatus(db, now);
  assert.equal(status.sources.find(({ source }) => source === "uca-rss")?.lastSuccessAt, now.toISOString());
  assert.equal((await db.prepare("SELECT count(*) AS n FROM owner_actions").first())?.n, 1);
});

test("overlapping runs use source leases and fencing; repeats create no duplicate proposals", async (t) => {
  const { db, reviews, fetcher } = await setup(t);
  await runDailySync(db, { reviews, fetcher, clock });
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const [source] = automaticSources(reviews, fetcher, () => now.toISOString());
  assert.ok(source);
  const holding = { name: source.name, async load() { entered(); await gate; return source.load(); } };
  const active = runDailySync(db, { reviews, sources: [holding], clock, runId: "holding" });
  await waiting;
  const overlap = await runDailySync(db, { reviews, sources: [source], clock, runId: "overlap" });
  assert.equal(overlap.sources[0]?.outcome, "skipped-overlap");
  release();
  assert.equal((await active).sources[0]?.outcome, "success");
  assert.equal((await pendingReviews(db)).length, 4);

  let expire!: () => void;
  let signal!: () => void;
  const started = new Promise<void>((resolve) => { signal = resolve; });
  const gate2 = new Promise<void>((resolve) => { expire = resolve; });
  let time = now;
  const slow = runDailySync(db, {
    reviews, clock: () => time, runId: "expired",
    sources: [{ name: source.name, async load() { signal(); await gate2; return source.load(); } }],
  });
  await started;
  time = new Date(now.getTime() + leaseMs + 1);
  const recovered = await runDailySync(db, { reviews, sources: [source], clock: () => time, runId: "recovered" });
  assert.equal(recovered.sources[0]?.outcome, "success");
  expire();
  assert.equal((await slow).sources[0]?.outcome, "abandoned");
  assert.equal((await pendingReviews(db)).length, 4);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM edition_revisions").first())?.n, 4);
});

test("transient failures retry boundedly, permanent errors stop, and cutoffs require no successful sync", async (t) => {
  let attempts = 0;
  const text = await downloadText(async () => ++attempts === 1
    ? new Response(null, { status: 429 }) : new Response("ok"), "https://example.org/feed", "text/plain");
  assert.equal(text, "ok");
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(downloadText(async () => { attempts++; return new Response(null, { status: 404 }); },
    "https://example.org/feed", "text/plain"), /404/);
  assert.equal(attempts, 1);
  const { db, reviews } = await setup(t);
  await runDailySync(db, { reviews, sources: [{
    name: "manual-test", async load() {
      return { records: [{
        title: "Cutoff test", category: "morocco", format: "in-person", countryCode: "MA",
        eventUrl: "https://example.org/", eventEnd: "2026-12-21", registrationDeadline: "2026-11-20T16:30:00+01:00",
        registrationStatus: "open", registrationNote: "Organizer call.",
        moroccoEligibility: { status: "confirmed", note: "Morocco accepted." },
        review: { url: "https://example.org/", checkedAt: now.toISOString() },
        provenance: { source: "cutoff", externalId: "1", method: "manual", url: "https://example.org/", checkedAt: now.toISOString() },
      }] };
    },
  }], clock });
  const pending = await inspectEdition(db, "cutoff:1");
  assert.ok(pending.pendingId);
  await decideRevision(db, "publish", "cutoff:1", pending.pendingId, null, now);
  const cutoff = new Date("2026-11-20T15:30:00Z");
  assert.equal((await publicCatalog(db, "open", { now })).length, 1);
  await runDailySync(db, { reviews, clock: () => cutoff, sources: [{
    name: "manual-test", async load() { throw new Error("Offline"); },
  }] });
  assert.deepEqual(await publicCatalog(db, "open", { now: cutoff }), []);
  assert.equal((await publicCatalog(db, "archive", { now: cutoff }))[0]?.id, "cutoff:1");
  assert.equal((await syncStatus(db, new Date("2027-01-01T00:00:00Z"))).organizerEvidenceNeedsRechecking.length, 1);
});

test("official feed HTML in CDATA is accepted but XML entity declarations fail without wiping data", async (t) => {
  const { db, reviews, fetcher, fixtures } = await setup(t);
  await runDailySync(db, { reviews, fetcher, clock });
  const report = await runDailySync(db, {
    reviews, clock, fetcher: async (request) => new Response(
      String(request).includes("github.blog/") ? fixtures.github.replace("<item>",
        '<item><description><![CDATA[<!DOCTYPE html><html><body>Article HTML</body></html>]]></description>')
        : String(request).includes("hackclub.com/") ? fixtures.api
          : '<!DOCTYPE rss [<!ENTITY example "value">]><rss><channel><title>Unsafe</title></channel></rss>',
    ),
  });
  assert.equal(report.sources.find(({ source }) => source === "github-gaming-rss")?.outcome, "success");
  assert.equal(report.sources.find(({ source }) => source === "uca-rss")?.outcome, "failed");
  assert.equal((await pendingReviews(db)).length, 4);
});

test("the real Worker scheduled handler runs locally in workerd and reuses the D1 review boundary", async (t) => {
  const { db, persist, response } = await setup(t);
  const runtime = await openScheduledD1(persist, async (request: { url: string }) => new RuntimeResponse(response(request.url)));
  try {
    await runtime.scheduled(now.getTime());
    assert.equal((await pendingReviews(db)).length, 4);
    assert.deepEqual(await publicCatalog(db, "all", { now }), []);
    await runtime.scheduled(now.getTime());
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sync_runs").first())?.n, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM edition_revisions").first())?.n, 4);
    const report = await syncStatus(db);
    assert.equal(report.intendedCronUTC, dailyCron);
    assert.ok(report.sources.every(({ latest }) => latest?.outcome === "success"));
  } finally {
    await runtime.close();
  }
});
