import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare-production";

// Exercise exactly the cf build artifact and copied assets, entirely on local workerd/D1.
export async function openProductionPreview(persist: string | false, port = 0) {
  const root = resolve(".cloudflare/output/v1/workers/default");
  const config = JSON.parse(await readFile(resolve(root, "worker.config.json"), "utf8"));
  const options = convertV4MiniflareOptions({
    name: "catalog", host: "127.0.0.1", port, modules: true, scriptPath: resolve(root, "bundle", config.manifest.mainModule),
    compatibilityDate: config.compatibilityDate, compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "ouahad-catalog-local" }, d1Persist: persist,
    bindings: { AUTH_MODE: "disabled", AUTH_ORIGIN: "https://hackathons.ouahad.space",
      EMAIL_SIGNIN_MODE: "disabled", EMAIL_DELIVERY_MODE: "disabled", EMAIL_PUBLIC_ENABLED: "false" },
  });
  if (persist) options.resourcePersistencePath = resolve(persist);
  options.workers[0]!.config.assets = {
    directory: resolve(root, "assets"), hasUserWorker: true,
    runWorkerFirst: true, notFoundHandling: "none",
  };
  options.workers[0]!.config.env ??= {};
  options.workers[0]!.config.env.ASSETS = { type: "assets" };
  return new Miniflare(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] ?? "4180");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port");
  const runtime = await openProductionPreview(process.env.OUAHAD_D1_PATH ?? ".local/d1-launch-worker", port);
  console.log(`Built Worker preview: ${await runtime.ready} (local D1, email disabled)`);
  process.on("SIGINT", async () => { await runtime.dispose(); process.exit(); });
  process.on("SIGTERM", async () => { await runtime.dispose(); process.exit(); });
}
