import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { openLocalD1, migrate } from "../src/local-d1.ts";
import { importIntoD1, inspectEdition, decideRevision } from "../src/catalog-write.ts";
import { phase1Sources } from "../src/phase1-seed.ts";
import { manualSource } from "../src/sources.ts";
import { listenCatalog } from "../src/web/server.ts";
import { startTypographyGallery } from "./typography-gallery.ts";

// Isolated local presentation store. Ignore all account/email/D1 environment configuration.
const folder = resolve(".local/agenda-redesign"), clock = () => new Date("2026-11-19T12:00:00Z");
await mkdir(folder, { recursive: true });
const runtime = await openLocalD1(resolve(folder, "d1"));
await migrate(runtime.db);
await importIntoD1(runtime.db, await phase1Sources(), { now: clock(), seedOnly: true });
await importIntoD1(runtime.db, [manualSource("data/launch-catalog.json")], { now: clock() });
const approve = ["add-open-data:hackathon-open-data-2026", "geek-room:infer-a-thon-2026", "hcp-tta:datathon-data-territoires-2026",
  "ibn-zohr-fsa:technovate-blue-tech-2026", "hack-united:united-hacks-v8", "github-game-off:game-off-2026", "nasa-space-apps:universal-event-2025", "hack-club:recDFXvSpx4603YEa", "uca-rss:https%3A%2F%2Fcim.uca.ma%2F%3Fp%3D5562"];
for (const id of approve) { const { pendingId } = await inspectEdition(runtime.db, id); if (pendingId) await decideRevision(runtime.db, "publish", id, pendingId, "Isolated local design preview", clock()); }
process.env.NODE_ENV = "development";
const preview = await listenCatalog(runtime.db, { port: 4186, now: clock, developmentAuth: true });
const variantB = await listenCatalog(runtime.db, { port: 4187, now: clock, developmentAuth: true,
  typographyCss: await readFile("public/typography.css","utf8") + "\n" + await readFile("public/typography-b.css","utf8") });
const typographyGallery=await startTypographyGallery();
if (process.argv.includes("--capture-before")) {
  for (const [name,path] of [["catalog","/"],["detail","/hackathons/add-open-data%3Ahackathon-open-data-2026"]]) {
    await writeFile(resolve(folder,`before-${name}.html`), await (await fetch(preview.url+path)).text());
  }
  await writeFile(resolve(folder,"before-catalog.css"), await readFile("public/catalog.css"));
}
const before = createServer(async (req,res) => {
  const path = new URL(req.url ?? "/", "http://local").pathname;
  const file = path === "/" ? "before-catalog.html" : path.startsWith("/hackathons/") ? "before-detail.html" : path === "/catalog.css" ? "before-catalog.css" : null;
  try { const body = file ? await readFile(resolve(folder,file)) : /^\/icons\/(?:logo_black|app_icon)\.png$/.test(path) ? await readFile(resolve("public"+path)) : null;
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200,{"Content-Type":path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":"text/html; charset=utf-8"}).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(4185,"127.0.0.1");
console.log(`Local prototype: ${preview.url} · before snapshot: http://127.0.0.1:4185 · fixed clock 19 Nov 2026, 12:00 UTC · local demo auth only · no email or sync jobs`);
console.log(`Typography A (Jakarta + Inter): ${preview.url} · B (Inter): ${variantB.url} · same data and clock`);
console.log(`Side-by-side typography gallery: ${typographyGallery.url}`);
process.on("SIGINT",async()=>{typographyGallery.close();before.close();await variantB.close();await preview.close();await runtime.close();process.exit();});
