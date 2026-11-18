import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import type { WorkerOptions } from "miniflare";
import { syncCompatibilityDate, dailyCron } from "./sync-schedule.ts";

// Bundle the shared Worker entrypoint, never the CLI or filesystem intake.
type LocalOutbound = Extract<WorkerOptions["outboundService"], (...args: never[]) => unknown>;

export async function openScheduledD1(persist = ".local/d1", outbound?: LocalOutbound) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./sync-worker.ts", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "browser"], external: ["node:crypto"],
  });
  const runtime = new Miniflare({
    host: "127.0.0.1", port: 0, modules: true,
    script: bundle.outputFiles[0]!.text,
    // Miniflare 4 uses this flag to resolve node: imports even though workerd now enables it by default.
    compatibilityDate: syncCompatibilityDate, compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "ouahad-catalog-local" }, d1Persist: persist,
    ...(outbound ? { outboundService: outbound } : {}),
  });
  try {
    const db = await runtime.getD1Database("DB");
    return {
      db, close: () => runtime.dispose(),
      async scheduled(time = Date.now()) {
        const worker = await runtime.getWorker();
        const result = await worker.scheduled({ scheduledTime: new Date(time), cron: dailyCron });
        if (result.outcome !== "ok") throw new Error(`Local scheduled handler outcome: ${result.outcome}`);
      },
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
