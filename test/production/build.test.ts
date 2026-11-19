import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import { openProductionPreview } from "../../src/production-preview.ts";
import { migrate } from "../../src/local-d1.ts";
import { importIntoD1, inspectEdition, decideRevision } from "../../src/catalog-write.ts";
import { manualSource } from "../../src/sources.ts";

test("real cf build serves approved D1 editions and exact public assets in workerd", async (t) => {
  const runtime = await openProductionPreview(false); t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("DB"); await migrate(db);
  const origin = (await runtime.ready).origin;
  const get = (path: string, init?: RequestInit) => fetch(origin + path, init);
  const empty = await get("/"); assert.equal(empty.status, 200, (await empty.text()).slice(0, 1800));
  const imported = await importIntoD1(db, [manualSource("data/launch-catalog.json")]);
  assert.equal(imported.totals?.drafts, 3);
  const id = "geek-room:infer-a-thon-2026", path = "/hackathons/" + encodeURIComponent(id);
  assert.equal((await get(path)).status, 404);
  assert.ok(!(await (await get("/")).text()).includes("Infer-a-thon"));
  const draft = await inspectEdition(db, id); assert.ok(draft.pendingId);
  await decideRevision(db, "publish", id, draft.pendingId);
  for (const lang of ["en", "fr", "ar"]) {
    const response = await get("/?lang=" + lang), body = await response.text();
    assert.equal(response.status, 200); assert.ok(body.includes("Infer-a-thon"));
    assert.match(body, new RegExp(`lang="${lang}"`));
    if (lang === "ar") assert.match(body, /dir="rtl"/);
    const detail = await get(path + "?lang=" + lang); assert.equal(detail.status, 200);
    assert.ok((await detail.text()).includes("https://luma.com/f7ef30j2"));
  }
  assert.equal((await get("/catalog.css", { method: "POST" })).status, 405);
  for (const asset of ["catalog.css", "private.css", "auth/google-g.svg", "icons/logo_black.png", "icons/app_icon.png"]) {
    const response = await get("/" + asset); assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile("public/" + asset));
  }
  const { stdout } = await promisify(execFile)("git", ["ls-tree", "-r", "--name-only", "HEAD", "public/icons"]);
  const tracked = stdout.trim().split(/\r?\n/);
  assert.equal((await readdir("public/icons")).length, tracked.length);
  for (const path of tracked) {
    const { stdout: committed } = await promisify(execFile)("git", ["show", `HEAD:${path}`], { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 });
    assert.deepEqual(await readFile(path), committed);
    assert.deepEqual(await readFile(".cloudflare/output/v1/workers/default/assets/" + path.slice(7)), committed);
  }
  assert.equal((await db.prepare("SELECT count(*) AS n FROM private_users").first())?.n, 0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM email_deliveries").first())?.n, 0);
});
