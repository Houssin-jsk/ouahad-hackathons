import { bindings, defineConfig, triggers } from "cf/config";
import { dailyCron, syncCompatibilityDate } from "./src/sync-schedule.ts";

// Intended configuration only. No account, remote database, route or deployment is created here.
export default defineConfig({
  worker: {
    name: "ouahad-hackathons-sync",
    entrypoint: "./src/sync-worker.ts",
    compatibilityDate: syncCompatibilityDate,
    env: {
      DB: bindings.d1({ name: "ouahad-catalog-local" }),
      ASSETS: bindings.assets(),
      // Explicitly opt in after OAuth client setup; these are not credentials.
      AUTH_MODE: bindings.text("disabled"),
      AUTH_ORIGIN: bindings.text("https://hackathons.ouahad.space"),
      GOOGLE_CLIENT_ID: bindings.text(""),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      EMAIL_DELIVERY_MODE: bindings.text("disabled"),
      EMAIL_SIGNIN_MODE: bindings.text("disabled"),
      EMAIL_PUBLIC_ENABLED: bindings.text("false"),
      EMAIL_MAILBOX_TEST_VERIFIED: bindings.text("false"),
      EMAIL_FROM: bindings.text("Ouahad Hackathons <no-reply@notify.ouahad.space>"),
      RESEND_API_KEY: bindings.secret(),
      EMAIL_ENCRYPTION_KEY: bindings.secret(),
      EMAIL_OWNER_ADDRESSES: bindings.secret(),
    },
    assets: { runWorkerFirst: true, notFoundHandling: "none" },
    triggers: [triggers.scheduled({ schedule: dailyCron })],
    observability: { enabled: true, traces: { enabled: true } },
  },
});
