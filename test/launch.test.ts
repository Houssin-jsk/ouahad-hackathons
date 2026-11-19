import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverySources, opportunityTitle, parseDiscoveryConfig } from "../src/discovery-config.ts";
import { rssSource } from "../src/sources-automatic.ts";
import { migrate, openLocalD1 } from "../src/local-d1.ts";
import { importIntoD1, inspectEdition, decideRevision, sourceQueue } from "../src/catalog-write.ts";
import { publicCatalog } from "../src/catalog-read.ts";
import { manualSource } from "../src/sources.ts";
import { catalogHandler } from "../src/web/catalog-handler.ts";

test("configurable official RSS discovers Arabic, French and English datathons without guessing facts", async () => {
  assert.equal(discoverySources.filter(({ enabled }) => enabled).length, 6);
  assert.throws(() => parseDiscoveryConfig([discoverySources[0], discoverySources[0]]), /Duplicate/);
  for (const title of ["Appel à candidature : Datathon", "هاكاثون البيانات المفتوحة", "International hackathon"])
    assert.equal(opportunityTitle(title), true);
  const xml = `<rss><channel><title>Official university</title>
    <item><title>هاكاثون البيانات المفتوحة</title><link>https://university.example/ar/hack</link><pubDate>Tue, 17 Nov 2026 09:00:00 GMT</pubDate></item>
    <item><title>Datathon — candidatures</title><link>https://university.example/fr/datathon</link><guid>edition-2026</guid></item>
    <item><title>University news</title><link>https://university.example/news</link></item>
    </channel></rss>`;
  const result = await rssSource(discoverySources[3]!, [], async () => new Response(xml)).load();
  assert.equal(result.needsReview?.length, 2);
  assert.equal(result.records.length, 0);
  assert.equal(result.needsReview?.[0]?.externalId, "https://university.example/ar/hack");
  assert.ok(result.observations?.every(({ fields }) => !("eventStart" in fields) && !("moroccoEligibility" in fields)));
});

test("launch file imports as reviewed drafts; multilingual edits cannot change an approved page; duplicates go to review", async (t) => {
  const runtime = await openLocalD1(false); t.after(runtime.close); await migrate(runtime.db);
  const now = new Date("2026-11-19T12:00:00Z"), db = runtime.db;
  const source = manualSource("data/launch-catalog.json");
  const first = await importIntoD1(db, [source], { now });
  assert.deepEqual(first.totals, { editions: 3, drafts: 3, published: 0 });
  assert.deepEqual(await publicCatalog(db, "all", { now }), []);
  const id = "add-open-data:hackathon-open-data-2026";
  const initial = await inspectEdition(db, id); assert.ok(initial.pendingId);
  await decideRevision(db, "publish", id, initial.pendingId, "Official launch evidence reviewed", now);
  const rows = (await source.load()).records;
  const row = rows[0]!;
  const updates = { ...row, summaries: { ...row.summaries, ar: {
    text: "ترجمة مقترحة تنتظر المراجعة", sourceUrl: row.eventUrl, method: "generated-draft" as const,
  } } };
  await importIntoD1(db, [{ name: "translation-review", load: async () => ({ records: [updates] }) }], { now });
  const before = await publicCatalog(db, "all", { now });
  assert.equal(before[0]?.summaries.ar?.text, row.summaries?.ar?.text);
  const pending = await inspectEdition(db, id);
  assert.equal(pending.pending?.facts.summaries?.ar?.text, updates.summaries.ar.text);
  const page = await catalogHandler(new Request("https://catalog.example/?lang=ar"), db, { auth: { mode: "disabled" }, now: () => now });
  const html = await page.text();
  assert.match(html, /lang="ar" dir="rtl"/);
  assert.ok(html.includes(row.summaries!.ar!.text));
  assert.ok(!html.includes(updates.summaries.ar.text));
  await importIntoD1(db, [{ name: "second-source", load: async () => ({ records: [{ ...row,
    provenance: { ...row.provenance, source: "duplicate-source", externalId: "duplicate" },
  }] }) }], { now });
  const candidates = (await sourceQueue(db, now)).candidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.possibleExistingEditions[0]?.id, id);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM editions").first())?.n, 3);
  const replay = await importIntoD1(db, [source], { now });
  assert.equal(replay.totals?.editions, 3);
  // The archive is real and distinct from registration/submission cutoffs.
  for (const entry of rows.slice(1)) {
    const draft = await inspectEdition(db, `${entry.provenance.source}:${encodeURIComponent(entry.provenance.externalId)}`);
    assert.ok(draft.pendingId); await decideRevision(db, "publish", draft.id, draft.pendingId, null, now);
  }
  assert.equal((await publicCatalog(db, "open", { now, audience: "international-online" }))[0]?.id, "geek-room:infer-a-thon-2026");
  assert.equal((await publicCatalog(db, "archive", { now }))[0]?.id, "hcp-tta:datathon-data-territoires-2026");
  assert.equal((await db.prepare("SELECT count(*) AS n FROM private_users").first())?.n, 0);
});

