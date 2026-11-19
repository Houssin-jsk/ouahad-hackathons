import { accountEmailConfig, resendConfig } from "./email/config.ts";
import { runTransactionalEmailJob } from "./email/service.ts";
import type { ExportedHandler, ScheduledController } from "@cloudflare/workers-types";
import type { InferEnv } from "cf/config";
import type config from "../cloudflare.config.ts";
import reviewData from "../data/source-reviews.json" with { type: "json" };
import { parseReviews } from "./review-policy.ts";
import { runDailySync } from "./sync.ts";
import { authConfig } from "./private/auth-config.ts";
import { catalogHandler } from "./web/catalog-handler.ts";
import { reminderCron } from "./reminder-schedule.ts";
import { dailyCron } from "./sync-schedule.ts";

export type SyncEnv = InferEnv<typeof config.worker>;

// Catalog discovery never invokes email. This is selected by its own Cron expression.
export async function runWorkerEmailJob(env:SyncEnv,now=new Date()){
  const config=env.EMAIL_REMINDER_MODE===undefined?resendConfig(env):accountEmailConfig(env,"reminder");
  if(!config||env.EMAIL_REMINDER_MODE===undefined&&!config.publicEnabled)return {state:"disabled"};
  return runTransactionalEmailJob(env.DB,config,{now,origin:env.AUTH_ORIGIN,limit:2});
}

const worker = {
  async scheduled(event: ScheduledController, env: SyncEnv) {
    if(event.cron===reminderCron){
      const results=await runWorkerEmailJob(env);
      console.log(JSON.stringify({type:"reminder-sync",scheduledTime:event.scheduledTime,
        results:Array.isArray(results)?results.map(({state})=>({state})):results}));
      return;
    }
    if(event.cron!==dailyCron)throw new Error("Unknown scheduled job");
    const report = await runDailySync(env.DB, {
      reviews: parseReviews(reviewData), trigger: "scheduled",
      runId: `scheduled:${event.cron}:${event.scheduledTime}`,
    });
    console.log(JSON.stringify({ type: "daily-sync", ...report }));
    if (report.sources.some(({ outcome }) => outcome === "failed" || outcome === "abandoned")) {
      throw new Error(`Daily sync ${report.id}: one or more sources failed; inspect sync history`);
    }
  },
  async fetch(request: Request, env: SyncEnv) {
    // Owner review still has no HTTP API. The deployed entrypoint never accepts demo/test auth.
    return catalogHandler(request, env.DB, {
      auth: authConfig(env, false),
      ...(env.ASSETS ? { asset: async (assetRequest: Request) => {
        const asset = await env.ASSETS.fetch(assetRequest.url, { method: assetRequest.method });
        return new Response(assetRequest.method === "HEAD" ? null : new Uint8Array(await asset.arrayBuffer()), {
          status: asset.status, headers: { "Content-Type": asset.headers.get("content-type") ?? "application/octet-stream",
            "Cache-Control": "public, max-age=600", "X-Content-Type-Options": "nosniff" },
        });
      } } : {}),
    });
  },
} satisfies Pick<ExportedHandler<SyncEnv>, "scheduled"> & { fetch: (request: Request, env: SyncEnv) => Promise<Response> };

export default worker;
