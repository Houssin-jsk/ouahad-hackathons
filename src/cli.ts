import { audiences, publicCatalog, publicViews } from "./catalog-read.ts";
import {
  decideRevision, importIntoD1, inspectEdition, pendingReviews, sourceQueue, withdrawEdition,
} from "./catalog-write.ts";
import { migrate, openLocalD1 } from "./local-d1.ts";
import { phase1Sources } from "./phase1-seed.ts";
import { loadReviews, manualSource } from "./sources.ts";
import { inspectSync, runDailySync, syncStatus } from "./sync.ts";
import { openScheduledD1 } from "./local-scheduled.ts";

const usage = `npm.cmd run catalog -- migrate
npm.cmd run catalog -- seed
npm.cmd run catalog -- import [data/references.json]
npm.cmd run catalog -- sync [data/source-reviews.json]
npm.cmd run catalog -- sync-scheduled [ISO-timestamp]
npm.cmd run catalog -- sync-status
npm.cmd run catalog -- sync-inspect <run-id>
npm.cmd run catalog -- review list
npm.cmd run catalog -- review candidates
npm.cmd run catalog -- review inspect <edition-id>
npm.cmd run catalog -- publish <edition-id> <revision-id>
npm.cmd run catalog -- reject <edition-id> <revision-id> [reason]
npm.cmd run catalog -- withdraw <edition-id> <reason>
npm.cmd run catalog -- list [all|open|archive] [morocco|international-online]`;

async function main() {
  const [command, first, second, third, ...extra] = process.argv.slice(2);
  if (command === "--help" && !first) {
    console.log(usage);
    return;
  }
  if (extra.length) throw new Error(usage);
  if (command === "sync-scheduled" && second === undefined) {
    const time = first ? Date.parse(first) : Date.now();
    if (!Number.isFinite(time)) throw new Error("Expected an ISO timestamp");
    const runtime = await openScheduledD1(process.env.OUAHAD_D1_PATH);
    try {
      await runtime.scheduled(time);
      console.log(JSON.stringify(await syncStatus(runtime.db), null, 2));
    } finally { await runtime.close(); }
    return;
  }

  const { db, close } = await openLocalD1(process.env.OUAHAD_D1_PATH);
  const show = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  try {
    if (command === "migrate" && first === undefined) {
      show({ applied: await migrate(db) });
    } else if (command === "sync" && second === undefined) {
      const report = await runDailySync(db, { reviews: await loadReviews(first ?? "data/source-reviews.json") });
      show(report);
      if (report.sources.some(({ outcome }) => outcome === "failed" || outcome === "abandoned")) process.exitCode = 1;
    } else if (command === "sync-status" && first === undefined) {
      show(await syncStatus(db));
    } else if (command === "sync-inspect" && first && second === undefined) {
      show(await inspectSync(db, first));
    } else if ((command === "seed" && first === undefined)
      || (command === "import" && second === undefined)) {
      const sources = command === "seed" ? await phase1Sources()
        : [manualSource(first ?? "data/references.json")];
      const report = await importIntoD1(db, sources, { seedOnly: command === "seed" });
      show(report);
      if (report.sources.some(({ ok }) => !ok)) process.exitCode = 1;
    } else if (command === "list" && third === undefined) {
      const view = publicViews.find((value) => value === (first ?? "all"));
      const audience = audiences.find((value) => value === second);
      if (!view || (second !== undefined && !audience)) throw new Error(usage);
      show(await publicCatalog(db, view, { audience }));
    } else if (command === "review" && first === "list" && !second) {
      show(await pendingReviews(db));
    } else if (command === "review" && first === "candidates" && !second) {
      show(await sourceQueue(db));
    } else if (command === "review" && first === "inspect" && second && third === undefined) {
      show(await inspectEdition(db, second));
    } else if (first && second && (command === "reject" || (command === "publish" && third === undefined))) {
      await decideRevision(db, command, first, second, third ?? null);
      show({ editionId: first, revisionId: second, action: command });
    } else if (command === "withdraw" && first && second && third === undefined) {
      await withdrawEdition(db, first, second);
      show({ editionId: first, action: command });
    } else {
      throw new Error(usage);
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
