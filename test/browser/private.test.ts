import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, type Page } from "playwright";
import { importIntoD1, inspectEdition, decideRevision } from "../../src/catalog-write.ts";
import { migrate, openLocalD1 } from "../../src/local-d1.ts";
import { phase1Sources } from "../../src/phase1-seed.ts";
import { listenCatalog } from "../../src/web/server.ts";
import { privateEntries } from "../../src/private/entries.ts";
import { dateControls } from "../../src/private/stage-form.ts";
import { agendaText } from "../../src/web/agenda-i18n.ts";

test("private browser journey with two accounts, advancement, conflicts, locales and RTL", { timeout: 120_000 }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "ouahad-private-browser-"));
  const runtime = await openLocalD1(join(folder, "d1"));
  const clock = () => new Date("2026-11-17T17:00:00Z");
  await migrate(runtime.db);
  await importIntoD1(runtime.db, await phase1Sources(), { now: clock(), seedOnly: true });
  const edition = "add-open-data:hackathon-open-data-2026";
  const review = await inspectEdition(runtime.db, edition);
  await decideRevision(runtime.db, "publish", edition, review.pendingId!, null, clock());
  const priorEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const server = await listenCatalog(runtime.db, { port: 0, now: clock, developmentAuth: true });
  if (priorEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorEnv;
  const browser = await chromium.launch({ channel: process.env.OUAHAD_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
  const aya = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const sami = await browser.newContext();
  const page = await aya.newPage(), other = await sami.newPage();
  page.setDefaultTimeout(8000); other.setDefaultTimeout(8000);
  t.after(async () => { await browser.close(); await server.close(); await runtime.close(); await rm(folder, { recursive: true, force: true }); });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const screenshots = process.env.OUAHAD_BROWSER_SCREENSHOTS;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const capture = async (name: string) => { if (screenshots) await page.screenshot({ path: join(screenshots, name + ".png"), fullPage: true }); };
  async function signIn(target: Page, identity: string) {
    await target.goto(server.url + "/my");
    await target.getByLabel("Test identity").selectOption(identity);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
    assert.equal(new URL(target.url()).pathname, "/my");
  }
  async function addOpportunity(title: string, name: string, start: string, end: string) {
    await page.goto(server.url + "/my/new");
    await page.getByLabel("Opportunity name", { exact: true }).fill(title);
    await page.getByLabel("Primary field", { exact: true }).fill("Robotics / الروبوتات");
    await page.getByLabel("Official link (optional)").fill("https://example.org/private-test");
    await fillStage(page.locator("fieldset"), name, start, end);
    await page.getByRole("button", { name: "Add privately", exact: true }).click();
    return new URL(page.url()).pathname;
  }
  async function fillStage(scope: ReturnType<Page["locator"]>, name: string, start: string, end: string) {
    await scope.getByLabel("Stage name", { exact: true }).fill(name);
    const first=dateControls(start,"Africa/Casablanca"),last=dateControls(end,"Africa/Casablanca");
    await scope.getByLabel(agendaText.en.startDate,{exact:true}).fill(first.date);
    await scope.getByLabel(agendaText.en.startTime,{exact:true}).fill(first.time);
    await scope.getByLabel(agendaText.en.endDate,{exact:true}).fill(last.date);
    await scope.getByLabel(agendaText.en.endTime,{exact:true}).fill(last.time);
    await scope.getByLabel("Source time zone", { exact: true }).fill("Africa/Casablanca");
    await scope.getByLabel("Format", { exact: true }).selectOption("in-person");
    await scope.getByLabel("Required attendance at these times").check();
  }
  async function progress(index: number, field: string, value: string) {
    const form = page.locator("section.private-stage").nth(index).locator('form.stage-form');
    await form.locator(`select[name="${field}"]`).selectOption(value);
    await form.getByRole("button",{name:agendaText.en.saveStage,exact:true}).click();
  }
  let regional = "", second = "", dayOnly = "";
  await t.test("public browsing, explicit save, independent identities and draft privacy", async () => {
    await page.goto(server.url);
    assert.equal(await page.getByRole("heading", { name: "Find your next hackathon." }).isVisible(), true);
    await signIn(page, "dev-aya");
    await signIn(other, "dev-sami");
    await page.goto(server.url + "/hackathons/" + encodeURIComponent(edition));
    const official = await page.getByRole("link", { name: /Apply on organizer/ }).getAttribute("href");
    assert.match(official!, /^https:\/\//);
    assert.equal((await privateEntries(runtime.db, "dev-aya", clock())).length, 0);
    await page.getByRole("link", { name: "Save", exact:true }).click();
    await page.getByRole("button", { name: "Save to My Hackathons", exact: true }).click();
    assert.equal((await privateEntries(runtime.db, "dev-aya", clock()))[0]!.stages[0]!.application, "not-submitted");
    const savedPath = new URL(page.url()).pathname;
    assert.equal((await other.request.get(server.url + savedPath)).status(), 404);
    await other.goto(server.url + "/my");
    assert.equal(await other.getByRole('heading',{name:agendaText.en.emptyTitle}).isVisible(), true);
    assert.equal((await page.request.get(server.url + "/hackathons/" + encodeURIComponent("think-ai:think-ai-morocco-2024"))).status(), 404);
  });
  await t.test("applied qualifier warns about a conditional final before acceptance", async () => {
    regional = await addOpportunity("Regional Robotics — PRIVATE TEST", "Regional qualifier", "2026-12-01T09:00:00+01:00", "2026-12-01T17:00:00+01:00");
    await page.locator(".language-control > summary").click(); await page.getByRole("link", { name: "Français", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("lang"), "fr");
    assert.equal(new URL(page.url()).pathname, regional);
    assert.equal(await page.getByRole("heading", { name: "Regional qualifier", exact: true }).isVisible(), true);
    await capture("my-french");
    await page.locator(".language-control > summary").click(); await page.getByRole("link", { name: "English", exact: true }).click();
    await page.locator("details.add-stage-panel > summary").click();
    const form = page.locator("details.add-stage-panel form");
    await fillStage(form, "National final", "2026-12-10T09:00:00+01:00", "2026-12-10T17:00:00+01:00");
    await form.getByLabel("Entry route", { exact: true }).selectOption("advancement");
    await form.getByLabel("Previous stage", { exact: true }).selectOption({ label: "Regional qualifier" });
    await form.getByRole("button", { name: "Add a stage", exact: true }).click();
    await progress(0, "application", "submitted");
    second = await addOpportunity("Second Hackathon — PRIVATE TEST", "Main hackathon", "2026-12-10T10:00:00+01:00", "2026-12-10T12:00:00+01:00");
    await progress(0, "application", "submitted");
    assert.equal(await page.locator('[data-conflict="confirmed"]').count(), 1);
    assert.match(await page.locator(".warnings").innerText(), /National final/);
    assert.match(await page.locator(".warnings").innerText(), /Conditional stage/);
    assert.match(await page.locator(".warnings").innerText(), /Application pending; acceptance is separate/);
    assert.match(await page.locator(".warnings").innerText(), /Morocco time/);
    await capture("my-before-acceptance");
  });
  await t.test("advancement does not imply acceptance; declining removes conflict and preserves history", async () => {
    await page.goto(server.url + regional);
    await progress(0, "decision", "accepted");
    await progress(0, "intent", "going");
    await progress(0, "attended", "1");
    await progress(0, "result", "advanced");
    assert.equal(await page.locator('section.private-stage').nth(1).locator('select[name="decision"]').inputValue(), "pending");
    await progress(1, "decision", "accepted");
    assert.doesNotMatch(await page.locator(".warnings").innerText(), /Conditional stage/);
    assert.match(await page.locator(".warnings").innerText(), /Accepted/);
    await capture("my-after-acceptance");
    await page.goto(server.url + second);
    await progress(0, "intent", "declined");
    assert.equal(await page.locator("[data-conflict]").count(), 0);
    await page.goto(server.url + "/my");
    const stats = await page.locator(".private-stats").innerText();
    assert.match(stats, /Competition entries\s+2/);
    assert.match(stats, /Editions accepted\s+1/);
    assert.match(stats, /Stage attendances\s+1/);
    assert.match(stats, /Advancements\s+1/);
    await capture("my-declined");
  });
  await t.test("date-only conflict, Arabic RTL, mixed content, mobile keyboard and account isolation", async () => {
    dayOnly = await addOpportunity("Date-only Design — PRIVATE TEST", "Design day", "2026-12-10", "2026-12-10");
    await progress(0, "application", "submitted");
    assert.equal(await page.locator('[data-conflict="possible"]').count(), 1);
    assert.equal(await page.locator('section.private-stage input[name="startTime"]').inputValue(),"");
    assert.equal(await page.locator('section.private-stage input[name="startDate"]').inputValue(),"2026-12-10");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".language-control > summary").click(); await page.getByRole("link", { name: "العربية", exact: true }).click();
    assert.equal(new URL(page.url()).pathname, dayOnly);
    assert.equal(await page.locator("html").getAttribute("lang"), "ar");
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.getByRole("heading", { name: "تنبيهات الجدول" }).isVisible(), true);
    assert.equal(await page.locator('h1 bdi[dir="auto"]').count(), 1);
    assert.equal(await page.locator('h2 bdi[dir="auto"]').first().isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await capture("my-arabic-mobile");
    const decision = page.locator('select[name="decision"]');
    await decision.focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => ["SELECT","BUTTON"].includes(document.activeElement?.tagName??"")), true);
    const crossRead = await other.request.get(server.url + dayOnly);
    assert.equal(crossRead.status(), 404);
    const csrf = await other.locator('input[name="csrf"]').first().inputValue();
    const entry = (await privateEntries(runtime.db, "dev-aya", clock())).find((row) => dayOnly.endsWith(row.id))!;
    const crossWrite = await other.request.post(server.url + dayOnly + "/progress", { headers: { Origin: server.url }, form: {
      csrf, stage: entry.stages[0]!.key, field: "decision", value: "accepted",
    } });
    assert.equal(crossWrite.status(), 404);
    assert.equal((await privateEntries(runtime.db, "dev-aya", clock(), entry.id))[0]!.stages[0]!.decision, "pending");
    assert.doesNotMatch(await (await page.request.get(server.url + "/")).text(), /PRIVATE TEST/);
    assert.equal((await page.request.get(server.url + "/hackathons/" + entry.id)).status(), 404);
    assert.deepEqual(errors, []);
  });
});
