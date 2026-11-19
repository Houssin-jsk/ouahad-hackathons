import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { codeMail } from "../src/email/copy.ts";
import { renderReminder, type StageReminder } from "../src/private/reminders.ts";

// Synthetic presentation fixtures only. No D1 binding, account, secret or sender is opened.
export const previewDirectory = resolve(".local/email-design");
export function previewReminder(language: "en" | "fr" | "ar", changed = false, dateOnly = false): StageReminder {
  return { id: "preview", user_id: "preview", entry_id: "preview-opportunity", stage_key: "preview-stage", schedule_hash: "preview", generation: changed ? 2 : 1,
    kind: changed ? "schedule-change" : "reminder", due_at: null, expires_at: null, state: "pending", reason: null, guard: "{}", version: 1, updated_at: "2026-11-19T12:00:00Z",
    payload: JSON.stringify({ title: "Atlas Data Challenge", stage: language === "ar" ? "النهائي الوطني · National final" : language === "fr" ? "Finale nationale" : "National final",
      start: dateOnly ? "2026-12-12" : "2026-12-12T09:30:00Z", end: dateOnly ? "2026-12-13" : "2026-12-12T17:00:00Z", zone: "Africa/Casablanca", recipient: "preview@example.invalid", language }) };
}

export async function writeEmailPreviews() {
  await mkdir(previewDirectory, { recursive: true });
  const links: string[] = [];
  for (const lang of ["en", "fr", "ar"] as const) {
    const address = codeMail("000000", "reminder-address", lang);
    const reminder = renderReminder(previewReminder(lang, false, lang === "ar"), "https://hackathons.ouahad.space", true);
    const change = renderReminder(previewReminder(lang, true), "https://hackathons.ouahad.space", true);
    for (const [kind, html, text] of [["verification", address.html!, address.text], ["reminder", reminder.html!, reminder.body], ["schedule-change", change.html!, change.body]]) {
      const name = `${kind}-${lang}`;
      await writeFile(resolve(previewDirectory, name + ".html"), html!, "utf8");
      await writeFile(resolve(previewDirectory, name + ".txt"), text!, "utf8");
      links.push(`<li><a href="/${name}.html">${name}</a> · <a href="/${name}.txt">Plain text</a></li>`);
    }
  }
  await writeFile(resolve(previewDirectory, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ouahad email design review</title><body style="margin:32px auto;padding:0 20px;max-width:680px;background:#F7F5EF;color:#10212B;font:16px/1.7 Arial,sans-serif;"><p style="color:#077F64">OUAHAD SPACE / HACKATHONS</p><h1 style="font:36px Georgia,serif">Transactional email review</h1><p>Synthetic previews. Code <strong>000000</strong> is a design sample. No real account or email delivery is involved. Stage buttons point to non-existent preview entries.</p><p>Each file uses the shared inline HTML layout. Resize to 390px for mobile. The Arabic reminder deliberately has dates without times; the schedule update shows exact times in Morocco time.</p><ul>${links.join("")}</ul></body></html>`);
  return previewDirectory;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  await writeEmailPreviews();
  console.log("Generated nine HTML previews and nine unchanged plain-text counterparts in .local/email-design.");
  if (process.argv.includes("--serve")) {
    const allowed = /^(?:index|(?:verification|reminder|schedule-change)-(?:en|fr|ar))\.(?:html|txt)$/;
    createServer(async (request, response) => {
      const name = new URL(request.url ?? "/", "http://localhost").pathname.slice(1) || "index.html";
      if (!allowed.test(name)) { response.writeHead(404).end(); return; }
      try { const body = await readFile(resolve(previewDirectory, name)); response.writeHead(200, { "Content-Type": name.endsWith("html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(body); }
      catch { response.writeHead(404).end(); }
    }).listen(4188, "127.0.0.1", () => console.log("Design review: http://127.0.0.1:4188 — no sender or database attached."));
  }
}
