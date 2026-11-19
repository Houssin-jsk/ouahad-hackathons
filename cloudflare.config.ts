import { bindings, defineConfig, triggers } from "cf/config";
import { dailyCron, syncCompatibilityDate } from "./src/sync-schedule.ts";
import { reminderCron } from "./src/reminder-schedule.ts";

// Production resources are explicit. Local Node previews continue using their separate Miniflare store.
export default defineConfig({
  worker: {
    name: "ouahad-hackathons",
    domains: ["hackathons.ouahad.space"],
    workersDev: false,
    previewUrls: false,
    entrypoint: "./src/sync-worker.ts",
    compatibilityDate: syncCompatibilityDate,
    env: {
      DB: bindings.d1({ name: "ouahad-hackathons-production", id: "eee8ef16-7e86-474a-bc4f-c6a9c95c8989" }),
      ASSETS: bindings.assets(),
      // Explicitly opt in after OAuth client setup; these are not credentials.
      AUTH_MODE: bindings.text("google"),
      AUTH_ORIGIN: bindings.text("https://hackathons.ouahad.space"),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      EMAIL_DELIVERY_MODE: bindings.text("resend"),
      EMAIL_SIGNIN_MODE: bindings.text("disabled"),
      EMAIL_ADDRESS_MODE: bindings.text("public"),
      EMAIL_REMINDER_MODE: bindings.text("public"),
      EMAIL_PUBLIC_ENABLED: bindings.text("true"),
      EMAIL_MAILBOX_TEST_VERIFIED: bindings.text("true"),
      EMAIL_FROM: bindings.text("Ouahad Hackathons <no-reply@notify.ouahad.space>"),
      RESEND_API_KEY: bindings.secret(),
      EMAIL_ENCRYPTION_KEY: bindings.secret(),
      EMAIL_OWNER_ADDRESSES: bindings.secret(),
      EMAIL_OWNER_USER_IDS: bindings.secret(),
    },
    assets: { runWorkerFirst: true, notFoundHandling: "none" },
    triggers: [triggers.scheduled({ schedule: dailyCron }),triggers.scheduled({ schedule: reminderCron })],
    observability: { enabled: true, traces: { enabled: true } },
  },
});
