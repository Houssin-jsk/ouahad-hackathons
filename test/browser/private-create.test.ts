import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { migrate, openLocalD1 } from "../../src/local-d1.ts";
import { listenCatalog } from "../../src/web/server.ts";
import { privateEntries } from "../../src/private/entries.ts";
import { privateText } from "../../src/web/private-i18n.ts";
import { externalFormText } from "../../src/web/external-form-i18n.ts";

test("private create keeps invalid input, corrects fields in EN/FR/AR and persists privately after reload", { timeout: 90_000 }, async (t) => {
  const runtime = await openLocalD1(false); await migrate(runtime.db);
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = "development";
  const server = await listenCatalog(runtime.db, { port: 0, developmentAuth: true });
  if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  const browser = await chromium.launch({ channel: process.env.OUAHAD_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
  t.after(async () => { await browser.close(); await server.close(); await runtime.close(); });
  const page = await browser.newPage(); page.setDefaultTimeout(8000);
  await page.goto(server.url + "/my/new");
  await page.getByLabel("Test identity").selectOption("dev-aya");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  for (const lang of ["en", "fr", "ar"] as const) {
    await page.setViewportSize(lang === "ar" ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(server.url + "/my/new?lang=" + lang);
    const form = page.locator("form.entry-create"), title = "Synthetic create check " + lang;
    await form.locator('[name="title"]').fill(title);
    await form.locator('[name="domain"]').fill("Data science / علوم البيانات");
    await form.locator('[name="eventUrl"]').fill("https://example.org/synthetic");
    await form.locator('[name="name"]').fill("Synthetic stage / مرحلة");
    await form.locator('[name="startDate"]').fill("2026-12-11");
    await form.locator('[name="endDate"]').fill("2026-12-10");
    await form.locator('[name="format"]').selectOption("online");
    await form.locator('[name="fixedAttendance"]').check();
    const [invalid] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/my/new"),
      form.getByRole("button", { name: privateText[lang].add, exact: true }).click(),
    ]);
    assert.equal(invalid.status(), 400);
    assert.ok((await page.getByRole("alert").innerText()).includes(externalFormText[lang].endAfterStart));
    assert.equal(await form.locator('[name="title"]').inputValue(), title);
    assert.equal(await form.locator('[name="eventUrl"]').inputValue(), "https://example.org/synthetic");
    assert.equal(await form.locator('[name="startDate"]').inputValue(), "2026-12-11");
    assert.equal(await form.locator('[name="format"]').inputValue(), "online");
    assert.equal(await form.locator('[name="fixedAttendance"]').isChecked(), true);
    assert.equal(await form.locator('[name="endDate"]').getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator("html").getAttribute("lang"), lang);
    assert.equal(await page.locator("html").getAttribute("dir"), lang === "ar" ? "rtl" : "ltr");
    // Fix only the highlighted date. Other fields, privacy, date-only precision and language survive.
    await form.locator('[name="endDate"]').fill("2026-12-12");
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/my/new"),
      form.getByRole("button", { name: privateText[lang].add, exact: true }).click(),
    ]);
    assert.equal(created.status(), 303);
    await page.waitForURL(/\/my\/entries\//);
    await page.reload();
    assert.equal(await page.getByRole("heading", { level: 1, name: title }).isVisible(), true);
    const ownPath = new URL(page.url()).pathname;
    const entries = await privateEntries(runtime.db, "dev-aya");
    assert.equal(entries.find((entry) => entry.title === title)?.stages[0]?.eventStart, "2026-12-11");
    assert.equal((await page.request.get(server.url + "/hackathons/" + ownPath.split("/").at(-1))).status(), 404);
    await page.goto(server.url + "/"); assert.ok(!(await page.locator("body").innerText()).includes(title));
  }
  assert.deepEqual(await privateEntries(runtime.db, "dev-sami"), []);
});
