import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare-production";
import { authConfig } from "../../src/private/auth-config.ts";
import { newSession } from "../../src/private/session.ts";
import { migrate } from "../../src/local-d1.ts";
import { privateEntries } from "../../src/private/entries.ts";
import { publicCatalog } from "../../src/catalog-read.ts";
import { externalFormText } from "../../src/web/external-form-i18n.ts";

test("built production create: provider sessions, field validation, reload persistence and ownership", async (t) => {
  const origin = "https://hackathons.ouahad.space";
  const env = { AUTH_MODE: "google", AUTH_ORIGIN: origin, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
    EMAIL_SIGNIN_MODE: "disabled", EMAIL_DELIVERY_MODE: "disabled" };
  const auth = authConfig(env, false); if (auth.mode !== "google") throw new Error("Fixture auth unavailable");
  const runtime = new Miniflare(convertV4MiniflareOptions({
    name: "private-create", host: "127.0.0.1", port: 0, modules: true,
    scriptPath: resolve(".cloudflare/output/v1/workers/default/bundle/sync-worker.js"),
    compatibilityDate: "2026-11-17", d1Databases: { DB: "private-create-test" }, d1Persist: false, bindings: env,
  }));
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("DB"); await migrate(db);
  await db.prepare("INSERT INTO private_users(id,name,kind) VALUES ('usr_create_one','Synthetic One','provider'),('usr_create_two','Synthetic Two','provider')").run();
  const one = await newSession(db, "usr_create_one", new Date(), undefined, auth.policy);
  const two = await newSession(db, "usr_create_two", new Date(), undefined, auth.policy);
  // Synthetic server-validated sessions exercise the production policy, not a live Google login.
  const send = async (path: string, account = one, values?: Record<string, string>, requestOrigin = origin) => {
    const response = await runtime.dispatchFetch(origin + path, {
      method: values ? "POST" : "GET", redirect: "manual",
      headers: { Cookie: account.setCookie.split(";")[0]!, Origin: requestOrigin,
        ...(values ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(values ? { body: new URLSearchParams({ csrf: account.session.csrf, ...values }).toString() } : {}),
    });
    return { status: response.status, location: response.headers.get("location"), cacheControl: response.headers.get("cache-control"), html: await response.text() };
  };
  const base = { title: 'Synthetic <create> check', domain: "data science", eventUrl: "", name: "Main event",
    entry: "direct", requiresStage: "", format: "online", fixedAttendance: "1", timeZone: "",
    startDate: "", startTime: "", endDate: "", endTime: "", startOccurrence: "", endOccurrence: "" };
  assert.equal((await send("/my/new")).status, 200);
  assert.equal((await send("/my/new", one, { ...base, csrf: "invalid" })).status, 403);
  assert.equal((await send("/my/new", one, base, "https://other.example")).status, 403);
  for (const [changes, field] of [
    [{ domain: " " }, "domain"],
    [{ eventUrl: "ftp://example.org/synthetic" }, "eventUrl"],
    [{ startDate: "2026-12-10", startTime: "09:00" }, "timeZone"],
    [{ startTime: "09:00" }, "startDate"],
    [{ startDate: "2026-12-10", startTime: "09:00", endDate: "2026-12-10", endTime: "09:00", timeZone: "Africa/Casablanca" }, "endDate"],
  ] as const) {
    const invalid = await send("/my/new", one, { ...base, ...changes });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.html.includes(`name="${field}" aria-label=`));
    assert.ok(invalid.html.includes(`id="create-${field}" aria-invalid="true"`));
  }
  for (const lang of ["en", "fr", "ar"] as const) {
    const invalid = await send("/my/new?lang=" + lang, one, { ...base, startDate: "2026-12-11", endDate: "2026-12-10" });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.html.includes(externalFormText[lang].endAfterStart));
    assert.match(invalid.html, /name="endDate"[^>]*aria-invalid="true"/);
    assert.ok(invalid.html.includes('value="Synthetic &lt;create&gt; check"'));
    assert.ok(invalid.html.includes('value="2026-12-11"'));
    assert.match(invalid.html, /name="fixedAttendance" value="1" checked/);
    assert.match(invalid.html, /class="private-form entry-create"/);
    assert.equal(invalid.cacheControl, "private, no-store");
  }
  for (const [changes, message] of [
    [{ domain: " " }, externalFormText.en.required],
    [{ eventUrl: "ftp://example.org" }, externalFormText.en.url],
    [{ startDate: "2026-12-10", startTime: "09:00" }, externalFormText.en.zoneRequired],
    [{ startTime: "09:00" }, externalFormText.en.dateRequired],
    [{ timeZone: "Not/AZone" }, externalFormText.en.zone],
    [{ startDate: "2026-03-08", startTime: "02:30", timeZone: "America/New_York" }, externalFormText.en.nonexistent],
    [{ startDate: "2026-11-01", startTime: "01:30", timeZone: "America/New_York" }, externalFormText.en.occurrence],
  ] as const) {
    const invalid = await send("/my/new", one, { ...base, ...changes });
    assert.equal(invalid.status, 400); assert.ok(invalid.html.includes(message));
  }
  assert.deepEqual(await privateEntries(db, "usr_create_one"), []);
  for (const changes of [
    {}, { startDate: "2026-12-10", endDate: "2026-12-10" },
    { startDate: "2026-12-10", startTime: "09:00", endDate: "2026-12-10", endTime: "17:00", timeZone: "Africa/Casablanca" },
  ]) {
    const created = await send("/my/new?lang=fr", one, { ...base, ...changes });
    assert.equal(created.status, 303); assert.ok(created.location?.includes("lang=fr"));
    const saved = await send(created.location!); assert.equal(saved.status, 200);
    assert.ok(saved.html.includes("Synthetic &lt;create&gt; check"));
    assert.equal((await send(created.location!, two)).status, 404);
    const id = created.location!.split("/").at(-1)!.split("?")[0]!;
    assert.equal((await send("/hackathons/" + id)).status, 404);
    assert.ok(!(await send("/")).html.includes("Synthetic"));
  }
  const persisted = await privateEntries(db, "usr_create_one");
  assert.equal(persisted.length, 3);
  assert.ok(persisted.some(({ stages }) => stages[0]!.eventStart === "2026-12-10"));
  assert.ok(persisted.some(({ stages }) => stages[0]!.eventStart === null));
  assert.deepEqual(await publicCatalog(db, "all"), []);
});
