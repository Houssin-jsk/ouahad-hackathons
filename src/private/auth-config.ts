import { resendConfig, type EmailEnvironment, type ResendConfig } from "../email/config.ts";
import { createHash } from "node:crypto";
import type { SessionPolicy } from "./session.ts";

export type AuthEnvironment = EmailEnvironment & {
  AUTH_MODE?: string; AUTH_ORIGIN?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  TEST_OIDC_ISSUER?: string; TEST_OIDC_CLIENT_ID?: string; TEST_OIDC_CLIENT_SECRET?: string;
  EMAIL_SIGNIN_MODE?: string;
};
export type ProviderConfig = {
  mode: "google" | "test-provider"; origin: string; issuer: string; clientId: string; clientSecret: string;
  policy: SessionPolicy;
  emailCapture?: boolean;
  emailLive?: ResendConfig;
};
export type AuthConfig = ProviderConfig | { mode: "demo"; origin: string; policy: SessionPolicy }
  | { mode: "disabled" } | { mode: "unavailable" };
const loopback = (url: URL) => ["127.0.0.1", "localhost"].includes(url.hostname);

export function authConfig(env: AuthEnvironment, development: boolean, localOrigin?: string): AuthConfig {
  const mode = env.AUTH_MODE ?? "disabled";
  if (mode === "disabled") return { mode };
  try {
    const origin = new URL(env.AUTH_ORIGIN || localOrigin || "");
    if (origin.href !== origin.origin + "/" || origin.username || origin.password) throw new Error();
    const local = development && loopback(origin) && origin.protocol === "http:";
    if (!local && (origin.protocol !== "https:" || loopback(origin))) throw new Error();
    if (mode === "demo") {
      if (!local) throw new Error();
      return { mode, origin: origin.origin, policy: { mode: "demo", realm: "demo", secure: false } };
    }
    if (mode !== "google" && mode !== "test-provider") throw new Error();
    if (mode === "test-provider" && !local) throw new Error();
    const issuer = mode === "google" ? "https://accounts.google.com" : env.TEST_OIDC_ISSUER;
    const clientId = mode === "google" ? env.GOOGLE_CLIENT_ID : env.TEST_OIDC_CLIENT_ID;
    const clientSecret = mode === "google" ? env.GOOGLE_CLIENT_SECRET : env.TEST_OIDC_CLIENT_SECRET;
    if (!issuer || !clientId?.trim() || !clientSecret?.trim()) throw new Error();
    if (mode === "test-provider") {
      const test = new URL(issuer);
      if (!loopback(test) || test.protocol !== "http:" || test.origin !== issuer) throw new Error();
    }
    const realm = createHash("sha256").update(JSON.stringify([issuer, clientId, origin.origin])).digest("hex");
    const live=resendConfig(env);
    return { ...(mode==="google"&&live&&((!local&&env.EMAIL_SIGNIN_MODE==="live"&&live.publicEnabled)||(local&&env.EMAIL_SIGNIN_MODE==="smoke"&&env.EMAIL_SMOKE_ALLOWED==="true"&&live.ownerAddresses.length))?{emailLive:{...live,ownerOnly:local}}:{}), mode, issuer, clientId, clientSecret, origin: origin.origin, emailCapture: local && env.EMAIL_SIGNIN_MODE === "capture",
      policy: { mode: "provider", realm, secure: !local } };
  } catch { return { mode: "unavailable" }; }
}
