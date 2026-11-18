import { openLocalD1 } from "./local-d1.ts";
import { listenCatalog } from "./web/server.ts";

async function main() {
  const args = process.argv.slice(2);
  const port = args.length === 0 ? 4173 : args.length === 2 && args[0] === "--port" ? Number(args[1]) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Usage: npm.cmd run preview -- [--port 4173]");
  }
  const d1 = await openLocalD1(process.env.OUAHAD_D1_PATH);
  try {
    const developmentAuth = process.env.OUAHAD_DEV_AUTH === "1";
    const catalog = await listenCatalog(d1.db, { port, developmentAuth, authEnvironment: process.env });
    console.log(`Ouahad Hackathons: ${catalog.url}`);
    console.log(`Private development accounts: ${developmentAuth && process.env.NODE_ENV === "development" ? "Aya / Sami (LOCAL ONLY)" : "disabled"}`);
    console.log(`Provider configuration mode: ${process.env.AUTH_MODE ?? "disabled"}`);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try { await catalog.close(); } finally { await d1.close(); }
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
  } catch (error) {
    await d1.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
