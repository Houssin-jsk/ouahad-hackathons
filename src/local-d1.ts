import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";

export type Database = Pick<D1Database, "prepare" | "batch">;

export async function openLocalD1(persist: string | false = ".local/d1") {
  const runtime = new Miniflare({
    // No server routes or remote bindings: the CLI uses the native D1 binding.
    host: "127.0.0.1",
    port: 0,
    modules: true,
    script: "export default {};",
    compatibilityDate: "2025-04-01",
    d1Databases: { DB: "ouahad-catalog-local" },
    d1Persist: persist,
  });
  try {
    const db: Database = await runtime.getD1Database("DB");
    return { db, close: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

export async function migrate(db: Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS catalog_migrations (
    name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL
  )`).run();
  const folder = new URL("../migrations/", import.meta.url);
  const names = (await readdir(folder)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const applied: string[] = [];
  for (const name of names) {
    const sql = await readFile(new URL(name, folder), "utf8");
    const checksum = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
    const prior = await db.prepare("SELECT checksum FROM catalog_migrations WHERE name = ?")
      .bind(name).first<string>("checksum");
    if (prior) {
      if (prior !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    const statements = sql.split(/^-- statement-break\s*$/m).map((s) => s.trim()).filter(Boolean);
    await db.batch([
      ...statements.map((statement) => db.prepare(statement)),
      db.prepare("INSERT INTO catalog_migrations (name, checksum) VALUES (?, ?)").bind(name, checksum),
    ]);
    applied.push(name);
  }
  return applied;
}
