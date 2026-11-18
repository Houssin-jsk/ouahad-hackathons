import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { list, runImport } from "../src/importer.ts";
import type { Source } from "../src/importer.ts";
import { reviewRow } from "../src/model.ts";
import { automaticSources, loadReviews, manualSource } from "../src/sources.ts";
import type { Fetcher } from "../src/sources.ts";
import { jsonRepository } from "../src/store.ts";

const reviewedAt = "2026-10-01T09:00:00Z";
const example = {
  source: "sample-organizer",
  externalId: "fall-edition",
  title: "Example Hackathon",
  category: "morocco",
  format: "in-person",
  countryCode: "MA",
  city: "Rabat",
  eventUrl: "https://example.org/hackathon",
  applicationUrl: "https://example.org/apply",
  rulesUrl: "https://example.org/rules",
  registrationStatus: "open",
  registrationNote: "Organizer's call is accepting applications.",
  moroccoEligibility: { status: "confirmed", note: "Open to students in Morocco." },
  eventStart: "2026-11-03",
  eventEnd: "2026-11-04",
  registrationDeadline: "2026-11-02",
  submissionDeadline: "2026-11-04T12:00:00+01:00",
  timeZone: "Africa/Casablanca",
  review: { url: "https://example.org/rules", checkedAt: reviewedAt },
};

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ouahad-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "catalog.json");
  const repo = jsonRepository(path);
  const input = join(directory, "input.json");
  const source = manualSource(input);
  const write = (rows: unknown[]) => writeFile(input, JSON.stringify(rows));
  await write([example]);
  return { repo, source, path, write };
}

test("reimporting identical manual records leaves the persisted catalog unchanged", async (t) => {
  const { repo, source, path } = await setup(t);
  await runImport(repo, [source], new Date(reviewedAt));
  const before = await readFile(path, "utf8");
  const report = await runImport(repo, [source], new Date("2026-10-03T00:00:00Z"));
  assert.equal(report.totalDrafts, 1);
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal((await repo.read())[0]?.publication, "draft");
});

test("a renamed and rescheduled edition keeps its ID and first import time", async (t) => {
  const { repo, source, write } = await setup(t);
  await runImport(repo, [source], new Date(reviewedAt));
  const [before] = await repo.read();
  assert.ok(before);
  await write([{ ...example, title: "New title", eventUrl: "https://example.org/updated",
    registrationDeadline: "2026-11-01" }]);
  await runImport(repo, [source]);
  const [after, duplicate] = await repo.read();
  assert.ok(after);
  assert.equal(duplicate, undefined);
  assert.equal(after.id, before.id);
  assert.equal(after.firstImportedAt, before.firstImportedAt);
  assert.equal(after.title, "New title");
  assert.equal(after.registrationDeadline, "2026-11-01");
  assert.equal(after.eventStart, "2026-11-03");
  assert.equal(after.submissionDeadline, "2026-11-04T12:00:00+01:00");
});

test("failed, malformed and empty sources do not wipe prior imports", async (t) => {
  const { repo, source, write } = await setup(t);
  const [rss] = automaticSources([], async () => new Response("", { status: 503 }));
  assert.ok(rss);
  const first = await runImport(repo, [source, rss]);
  assert.equal(first.totalDrafts, 1);
  assert.equal(first.sources[1]?.ok, false);
  const prior = await repo.read();

  await write([{ ...example, title: "Do not partially apply" },
    { ...example, externalId: "bogus", eventStart: "2026-02-30" }]);
  const second = await runImport(repo, [source, rss]);
  assert.deepEqual(second.sources.map(({ ok }) => ok), [false, false]);
  assert.deepEqual(await repo.read(), prior);

  await write([]);
  await runImport(repo, [source]);
  assert.deepEqual(await repo.read(), prior);
});

test("expiry uses the registration deadline or event end and preserves the draft", async (t) => {
  const { repo, source, write } = await setup(t);
  await write([example, { ...example, externalId: "no-registration-cutoff", registrationDeadline: null,
    eventEnd: "2026-11-04T16:30:00+01:00" }]);
  await runImport(repo, [source]);
  const rows = await repo.read();
  assert.equal(list(rows, "open", new Date("2026-11-02T22:59:59Z")).length, 2);
  const registrationClosed = new Date("2026-11-02T23:00:00Z");
  assert.equal(list(rows, "open", registrationClosed).length, 1);
  assert.equal(list(rows, "archive", registrationClosed)[0]?.id, "sample-organizer:fall-edition");
  const submissionPassed = new Date("2026-11-04T11:00:01Z");
  assert.equal(list(rows, "open", submissionPassed).length, 1);
  const eventEnded = new Date("2026-11-04T15:30:00Z");
  assert.equal(list(rows, "open", eventEnded).length, 0);
  assert.equal(list(rows, "archive", eventEnded).length, 2);
  assert.deepEqual(await repo.read(), rows);
});

test("both adapters use source IDs; format and program dates do not imply eligibility or registration", async (t) => {
  const { repo } = await setup(t);
  const reviews = [
    reviewRow.parse({ source: "hack-club", externalId: "rec1", facts: { review: example.review } }),
    reviewRow.parse({ source: "uca-rss", externalId: "post-1",
      facts: { countryCode: "MA", review: example.review } }),
  ];
  let title = "Example Hackathon";
  const fetcher: Fetcher = async (request) => String(request).startsWith("https://hackclub.com/")
    ? Response.json({ data: [
      { id: "rec1", name: title, url: "https://example.org/hackathon", description: null,
        format: "online", status: "ongoing", startDate: "2026-10-01", endDate: "2027-01-01" },
      { id: "rec2", name: "Another Hackathon", url: "https://example.org/other", description: null,
        format: "online", startDate: "2026-10-01", endDate: null },
    ], meta: { count: 2 } })
    : new Response(`<rss><channel><title> organizer </title><item><title>${title}</title>
      <link>https://example.org/news</link><guid>post-1</guid>
      <pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>`);
  const sources = automaticSources(reviews, fetcher);
  await runImport(repo, sources);
  title = "Updated name";
  const report = await runImport(repo, sources);
  assert.equal(report.totalDrafts, 2);
  const rows = await repo.read();
  const online = rows.find(({ id }) => id === "hack-club:rec1");
  const local = rows.find(({ id }) => id === "uca-rss:post-1");
  assert.ok(online && local);
  assert.equal(online.eventStart, "2026-10-01");
  assert.equal(local.eventStart, null);
  assert.equal(online.title, title);
  assert.equal(local.title, title);
  assert.equal(online.moroccoEligibility.status, "unknown");
  assert.equal(online.registrationStatus, "unknown");
  assert.equal(online.registrationDeadline, null);
  assert.equal(online.submissionDeadline, null);
  assert.equal(online.review?.checkedAt, reviewedAt);
  assert.equal(list(rows, "open", new Date(reviewedAt)).length, 0);
});

test("ten real announcements import as drafts across both categories using captured feed samples", async (t) => {
  const { repo } = await setup(t);
  const reviews = await loadReviews("data/source-reviews.json");
  const fixtures = {
    rss: await readFile("test/fixtures/uca-rss.xml", "utf8"),
    api: await readFile("test/fixtures/hack-club.json", "utf8"),
  };
  const sources = automaticSources(reviews, async (request) =>
    new Response(String(request).startsWith("https://hackclub.com/") ? fixtures.api : fixtures.rss));
  const report = await runImport(repo, [manualSource("data/references.json"), ...sources]);
  assert.deepEqual(report.sources.map(({ ok }) => ok), [true, true, true]);
  assert.equal(report.totalDrafts, 10);
  const rows = await repo.read();
  assert.equal(rows.filter((row) => row.category === "morocco").length, 5);
  assert.equal(rows.filter((row) => row.category === "international-online").length, 5);
  assert.equal(rows.filter((row) => row.provenance.method === "automatic").length, 4);
  assert.ok(rows.every((row) => row.publication === "draft"));
  assert.equal(rows.find((row) => row.provenance.externalId === "https://cim.uca.ma/?p=5562")
    ?.registrationDeadline, "2026-11-04");
});
