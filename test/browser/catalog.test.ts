import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { decideRevision, importIntoD1, inspectEdition } from "../../src/catalog-write.ts";
import { migrate, openLocalD1 } from "../../src/local-d1.ts";
import { phase1Sources } from "../../src/phase1-seed.ts";
import { listingPath } from "../../src/web/catalog-page.ts";
import { listenCatalog } from "../../src/web/server.ts";
import { messages } from "../../src/web/i18n.ts";

const add = "add-open-data:hackathon-open-data-2026";
const tech = "ibn-zohr-fsa:technovate-blue-tech-2026";
const united = "hack-united:united-hacks-v8";
const github = "github-game-off:game-off-2026";
const nasa = "nasa-space-apps:universal-event-2025";
const radish = "hack-club:recDFXvSpx4603YEa";
const water = "uca-rss:https%3A%2F%2Fcim.uca.ma%2F%3Fp%3D5562";
const draft = "think-ai:think-ai-morocco-2024";
const clock = () => new Date("2026-11-17T17:00:00Z");

type Cleanup = (() => Promise<void>)[];

async function preview(cleanup: Cleanup, directory: string, approved: string[] = []) {
  const runtime = await openLocalD1(directory);
  cleanup.push(runtime.close);
  await migrate(runtime.db);
  const seed = await importIntoD1(runtime.db, await phase1Sources(), { now: clock(), seedOnly: true });
  assert.deepEqual(seed.totals, { editions: 10, drafts: 10, published: 0 });
  for (const id of approved) {
    const { pendingId } = await inspectEdition(runtime.db, id);
    assert.ok(pendingId);
    await decideRevision(runtime.db, "publish", id, pendingId, null, clock());
  }
  const server = await listenCatalog(runtime.db, { port: 0, now: clock });
  cleanup.push(server.close);
  return server.url;
}

test("browsing approved editions through the browser and local D1", { timeout: 120_000 }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "ouahad-browser-"));
  const cleanup: Cleanup = [() => rm(folder, { recursive: true, force: true })];
  try {
    const empty = await preview(cleanup, join(folder, "empty"));
    const populated = await preview(cleanup, join(folder, "populated"), [add, tech, united, github, nasa, radish, water]);
    const browser = await chromium.launch({
      channel: process.env.OUAHAD_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
    });
    cleanup.push(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const screenshots = process.env.OUAHAD_BROWSER_SCREENSHOTS;
    if (screenshots) await mkdir(screenshots, { recursive: true });
    const capture = async (name: string) => {
      if (screenshots) await page.screenshot({ path: join(screenshots, `${name}.png`), fullPage: true });
    };
    const titles = () => page.locator(".card h3").allTextContents();
    const views = page.getByRole("navigation", { name: "Location view" });

    await t.test("empty state and draft invisibility through direct HTTP", async () => {
      const result = await page.goto(empty);
      assert.equal(result?.status(), 200);
      assert.equal(await page.getByRole("heading", { name: "No published hackathons to show" }).isVisible(), true);
      assert.deepEqual(await titles(), []);
      await capture("catalog-empty");
      const hidden = await page.request.get(empty + listingPath(add));
      assert.equal(hidden.status(), 404);
      assert.doesNotMatch(await hidden.text(), /Open Data 2026/);
      const publishedHttp = await page.request.get(populated + listingPath(add));
      assert.equal(publishedHttp.status(), 200);
      const neverPublished = await page.request.get(populated + listingPath(draft));
      assert.equal(neverPublished.status(), 404);
      assert.equal(await neverPublished.text(), await hidden.text());
      assert.equal((await page.request.get(populated + "/data/references.json")).status(), 404);
      const method = await page.request.post(populated, { data: { publish: draft } });
      assert.equal(method.status(), 405);
      assert.equal(method.headers().allow, "GET, HEAD");
    });

    await t.test("all views, confirmed open, and combined search and filters", async () => {
      await page.goto(populated);
      assert.equal((await titles()).length, 4);
      assert.equal((await titles())[0], "Hackathon Open Data 2026");
      assert.equal(await page.getByText("Think AI Morocco 2024").count(), 0);
      const game = page.getByRole("article", { name: "GitHub Game Off 2026" });
      assert.match(await game.innerText(), /Check eligibility/);
      assert.doesNotMatch(await game.innerText(), /Confirmed open/);
      await capture("catalog-desktop");
      await page.getByRole("link", { name: "Open registrations", exact: true }).click();
      assert.deepEqual(await titles(), ["Hackathon Open Data 2026"]);
      await page.getByRole("link", { name: "Clear all", exact: true }).click();
      await views.getByRole("link", { name: "International Online" }).click();
      assert.deepEqual(await titles(), ["United Hacks v8"]);
      assert.match(await page.locator(".card").innerText(), /Application deadline\s+Not published/);
      await views.getByRole("link", { name: "In Morocco" }).click();
      assert.deepEqual(await titles(), ["Hackathon Open Data 2026", "TechNovate Hackathon — Blue Tech"]);
      await page.locator("summary").click();
      await page.getByRole("searchbox", { name: "Search" }).fill("technovate agadir");
      await page.getByLabel("Field", { exact: true }).selectOption("aquaculture");
      await page.getByLabel("City", { exact: true }).selectOption("Agadir");
      await page.getByLabel("Format", { exact: true }).selectOption("in-person");
      await page.getByLabel("Registration", { exact: true }).selectOption("unknown");
      await page.getByRole("button", { name: "Apply filters" }).click();
      assert.deepEqual(await titles(), ["TechNovate Hackathon — Blue Tech"]);
      assert.equal(new URL(page.url()).searchParams.get("city"), "Agadir");
      await page.getByRole("searchbox", { name: "Search" }).fill("does-not-exist");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      assert.equal(await page.getByRole("heading", { name: "No matching hackathons" }).isVisible(), true);
      await page.getByRole("link", { name: "Clear all", exact: true }).first().click();
      assert.equal((await titles()).length, 2);
    });

    await t.test("official detail links, date precision, Morocco time, and archive", async () => {
      await page.goto(populated);
      await page.getByRole("link", { name: "View details: Hackathon Open Data 2026" }).click();
      assert.equal(await page.getByRole("heading", { level: 1, name: "Hackathon Open Data 2026" }).isVisible(), true);
      assert.match(await page.locator(".detail-head").innerText(), /Agence de Développement du Digital/);
      assert.match(await page.locator(".timing").innerText(), /Application deadline\s+20 Nov 2026, 16:30 Morocco time/);
      assert.match(await page.locator(".timing").innerText(), /Event dates\s+21\s*[–-]\s*22 Dec 2026/);
      assert.match(await page.locator(".timing").innerText(), /Project submission deadline\s+Not published/);
      assert.match(await page.getByRole("link", { name: "Apply on organizer’s site" }).getAttribute("href") ?? "", /^https:\/\/data\.gov\.ma\//);
      assert.equal(await page.getByRole("link", { name: "Official rules" }).count(), 1);
      await capture("catalog-detail");
      await page.goto(populated + listingPath(united));
      assert.match(await page.locator(".timing").innerText(), /Project submission deadline\s+10 Jan 2027, 18:00 Morocco time/);
      assert.match(await page.locator(".timing").innerText(), /Application deadline\s+Not published/);
      assert.equal(await page.getByRole("link", { name: "Apply on organizer’s site" }).count(), 0);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Archive" }).click();
      assert.equal((await titles()).length, 3);
      assert.match(await page.getByRole("article", { name: "Radish Jam" }).innerText(), /Finished/);
      assert.match(await page.getByRole("article", { name: /Water4Future/ }).innerText(), /Applications closed/);
      await page.getByRole("link", { name: /View details: .*Water4Future/ }).click();
      assert.equal(await page.getByRole("heading", { level: 1, name: /Water4Future/ }).isVisible(), true);
      await page.getByRole("link", { name: "Back to archive" }).click();
      await views.getByRole("link", { name: "International Online" }).click();
      assert.equal((await titles()).length, 2);
      await page.getByRole("link", { name: /View details: NASA Space Apps/ }).click();
      assert.match(await page.locator(".timing").innerText(), /team creator's local time/);
    });

    await t.test("mobile viewport has usable filters and no horizontal overflow", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(populated);
      assert.equal(await page.locator(".cards").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await capture("catalog-mobile");
      await views.getByRole("link", { name: "International Online" }).click();
      await page.locator("summary").click();
      await page.getByLabel("Format", { exact: true }).selectOption("online");
      await page.getByRole("button", { name: "Apply filters" }).click();
      assert.deepEqual(await titles(), ["United Hacks v8"]);
      await page.getByRole("link", { name: "View details: United Hacks v8" }).click();
      assert.equal(await page.getByRole("link", { name: "Organizer registration page" }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
    });

    await t.test("three languages on desktop and mobile, including empty and RTL views", async () => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        for (const lang of ["en", "fr", "ar"] as const) {
          const t = messages[lang];
          await page.goto(populated + (lang === "en" ? "" : "?lang=" + lang));
          assert.equal(await page.locator("html").getAttribute("lang"), lang);
          assert.equal(await page.locator("html").getAttribute("dir"), lang === "ar" ? "rtl" : "ltr");
          assert.deepEqual((await titles()).sort(), [
            "Hackathon Open Data 2026", "TechNovate Hackathon — Blue Tech", "United Hacks v8", "GitHub Game Off 2026",
          ].sort());
          assert.equal(await page.getByRole("searchbox", { name: t.search, exact: true }).isVisible(), true);
          assert.equal((await page.locator("summary").innerText()).trim(), t.filters);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          await capture(`after-${lang}-${width}`);
          await page.getByRole("link", { name: t.details + ": Hackathon Open Data 2026", exact: true }).click();
          assert.equal(await page.getByRole("heading", { name: "Hackathon Open Data 2026", exact: true }).isVisible(), true);
          assert.equal(await page.getByRole("link", { name: t.applyOfficial, exact: true }).isVisible(), true);
          assert.match(await page.locator(".timing").innerText(), /16:30/);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          await capture(`detail-${lang}-${width}`);
          await page.goto(populated + "/archive?lang=" + lang);
          assert.equal(await page.getByRole("heading", { name: t.archiveTitle, exact: true }).isVisible(), true);
          assert.equal(await page.getByRole("article", { name: "Radish Jam", exact: true }).getByText(t.finished, { exact: true }).isVisible(), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          await capture(`archive-${lang}-${width}`);
          await page.goto(empty + "?lang=" + lang);
          assert.equal(await page.getByRole("heading", { name: t.empty }).isVisible(), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          assert.equal(await page.getByText("Hackathon Open Data 2026", { exact: true }).count(), 0);
          await capture(`empty-${lang}-${width}`);
          const hidden = await page.request.get(populated + listingPath(draft) + "?lang=" + lang);
          assert.equal(hidden.status(), 404);
          assert.doesNotMatch(await hidden.text(), /Think AI Morocco 2024/);
        }
      }
    });

    await t.test("URL filters and chips survive listing visits and language switches", async () => {
      await page.goto(populated + "/?q=technovate&city=Agadir&field=aquaculture&format=in-person&status=unknown&audience=morocco");
      assert.deepEqual(await titles(), ["TechNovate Hackathon — Blue Tech"]);
      assert.equal(await page.locator("details").getAttribute("open"), null);
      assert.equal(await page.locator(".chip").count(), 5);
      await page.getByRole("link", { name: "Français", exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get("city"), "Agadir");
      await page.getByRole("link", { name: "Voir les détails: TechNovate Hackathon — Blue Tech", exact: true }).click();
      assert.equal(await page.locator("html").getAttribute("lang"), "fr");
      await page.getByRole("link", { name: "العربية", exact: true }).click();
      assert.equal(new URL(page.url()).pathname, listingPath(tech));
      assert.equal(await page.locator(".detail-head h1 bdi").getAttribute("dir"), "auto");
      assert.equal(await page.getByRole("heading", { name: "TechNovate Hackathon — Blue Tech", exact: true }).isVisible(), true);
      assert.equal(await page.locator(".detail-head h1 bdi").evaluate((node) => getComputedStyle(node).direction), "ltr");
      await capture("detail-ar-mobile");
      await page.getByRole("link", { name: messages.ar.backCatalog, exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get("q"), "technovate");
      assert.equal(new URL(page.url()).searchParams.get("format"), "in-person");
      assert.equal(new URL(page.url()).searchParams.get("lang"), "ar");
      assert.deepEqual(await titles(), ["TechNovate Hackathon — Blue Tech"]);
      await page.locator(".chip").filter({ hasText: messages.ar.field }).click();
      assert.equal(new URL(page.url()).searchParams.has("field"), false);
      assert.equal(new URL(page.url()).searchParams.get("city"), "Agadir");
      await page.getByRole("link", { name: messages.ar.clear, exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get("audience"), "morocco");
      assert.equal(new URL(page.url()).searchParams.has("q"), false);
      await page.goto(populated + "/archive?lang=ar&status=finished&audience=international-online");
      await page.getByRole("link", { name: /عرض التفاصيل: NASA/ }).click();
      await page.getByRole("link", { name: "Français", exact: true }).click();
      await page.getByRole("link", { name: messages.fr.backArchive, exact: true }).click();
      assert.equal(new URL(page.url()).pathname, "/archive");
      assert.equal(new URL(page.url()).searchParams.get("status"), "finished");
      assert.equal(new URL(page.url()).searchParams.get("lang"), "fr");
    });

    await t.test("keyboard can reach search, filters, chips, and detail links", async () => {
      await page.goto(populated + "/?lang=ar&city=Agadir");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".skip-link").evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#main").evaluate((node) => node === document.activeElement), true);
      await page.getByRole("searchbox", { name: messages.ar.search, exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".search-submit").evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("summary").evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("details").getAttribute("open"), "");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#filter-field").evaluate((node) => node === document.activeElement), true);
      await page.locator(".chip").focus();
      assert.equal(await page.locator(".chip").evaluate((node) => node === document.activeElement), true);
      await page.locator("summary").click();
      await page.locator(".card-details").focus();
      await page.keyboard.press("Enter");
      await page.waitForURL((url) => url.pathname === listingPath(tech));
      assert.equal(new URL(page.url()).pathname, listingPath(tech));
      assert.deepEqual(errors, []);
    });
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
});
