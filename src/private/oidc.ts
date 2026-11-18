import { randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import type { Database } from "../local-d1.ts";
import type { ProviderConfig } from "./auth-config.ts";
import { hash, newSession, readCookie, type Session } from "./session.ts";

const random = () => randomBytes(32).toString("hex");
export const callbackPath = "/auth/callback";
export const transactionCookieName = (config: ProviderConfig) => config.policy.secure ? "__Host-ouahad_oidc" : "ouahad_oidc";
const transactionCookie = (config: ProviderConfig, token: string, age = 600) =>
  `${transactionCookieName(config)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.policy.secure ? "; Secure" : ""}`;
export const clearTransactionCookie = (config: ProviderConfig) => transactionCookie(config, "", 0);

export function safeReturn(value: string | null, lang?: string) {
  let path = "/my";
  if (value && value.length <= 4096 && value.startsWith("/") && !value.startsWith("//") && !/[\\\x00-\x20\x7f]/.test(value)) {
    const url = new URL(value, "https://local");
    if (url.origin === "https://local" && (url.pathname === "/" || url.pathname === "/archive"
      || /^\/(?:my(?:\/|$)|hackathons\/)/.test(url.pathname))) path = url.pathname + url.search;
  }
  const target = new URL(path, "https://local");
  if (lang === "en") target.searchParams.delete("lang");
  else if (lang === "fr" || lang === "ar") target.searchParams.set("lang", lang);
  return target.pathname + target.search;
}

async function configuration(config: ProviderConfig) {
  const fetchProvider: oidc.CustomFetch = async (url, options) => {
    const target = new URL(String(url));
    const allowed = config.mode === "google"
      ? target.protocol === "https:" && ["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"].includes(target.hostname)
      : target.origin === config.issuer;
    if (!allowed || target.username || target.password) throw new Error("Untrusted provider endpoint");
    const bodyInit = options.body instanceof Uint8Array ? new Uint8Array(options.body) : options.body;
    const response = await fetch(url, { ...options, body: bodyInit, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Provider redirects are not accepted");
    }
    // Metadata, token responses, and key sets are small JSON documents, never unbounded buffers.
    const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 512 * 1024) throw new Error("Provider response too large");
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    const body = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) { body.set(chunk, position); position += chunk.length; }
    return new Response(length ? body : null, { status: response.status, headers: response.headers });
  };
  const client = await oidc.discovery(new URL(config.issuer), config.clientId,
    { client_secret: config.clientSecret, id_token_signed_response_alg: "RS256" }, oidc.ClientSecretPost(config.clientSecret), {
      timeout: 8, [oidc.customFetch]: fetchProvider,
      execute: [oidc.enableNonRepudiationChecks, ...(config.mode === "test-provider" ? [oidc.allowInsecureRequests] : [])],
    });
  return client;
}

export async function beginSignIn(db: Database, config: ProviderConfig, session: Session, returnPath: string, now: Date) {
  const client = await configuration(config);
  const verifier = oidc.randomPKCECodeVerifier(), state = random(), browser = random(), nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(client, {
    response_type: "code", scope: "openid profile", redirect_uri: config.origin + callbackPath,
    state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
    // Choosing an account again after app logout doesn't sign the user out of Google itself.
    prompt: "select_account", ui_locales: new URL(returnPath, config.origin).searchParams.get("lang") ?? "en",
  });
  if (config.mode === "google" && url.origin !== "https://accounts.google.com") throw new Error("Invalid authorization endpoint");
  if (config.mode === "test-provider" && url.origin !== config.issuer) throw new Error("Invalid test authorization endpoint");
  await db.batch([
    db.prepare("DELETE FROM auth_transactions WHERE expires_at <= ? OR session_hash = ?")
      .bind(now.toISOString(), session.token_hash),
    db.prepare(`INSERT INTO auth_transactions
      (state_hash, browser_hash, session_hash, realm, nonce, verifier, return_path, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(hash(state), hash(browser), session.token_hash, config.policy.realm, nonce, verifier, returnPath,
        new Date(now.getTime() + 600_000).toISOString()),
  ]);
  return { location: url.href, setCookie: transactionCookie(config, browser) };
}

type Transaction = { nonce: string; verifier: string; return_path: string };
export async function consumeTransaction(db: Database, config: ProviderConfig, request: Request, session: Session, now: Date) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => query.getAll(key).length !== 1)) return null;
  const state = query.get("state"), browser = readCookie(request.headers.get("cookie"), transactionCookieName(config));
  if (!state || !browser || !/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser)) return null;
  // Consume before exchanging the code. Parallel callbacks and replay cannot create a second session.
  return db.prepare(`DELETE FROM auth_transactions WHERE state_hash = ? AND browser_hash = ? AND session_hash = ?
    AND realm = ? AND expires_at > ? RETURNING nonce, verifier, return_path`)
    .bind(hash(state), hash(browser), session.token_hash, config.policy.realm, now.toISOString()).first<Transaction>();
}

export async function completeSignIn(db: Database, config: ProviderConfig, request: Request, transaction: Transaction, session: Session, now: Date) {
  const client = await configuration(config);
  const state = new URL(request.url).searchParams.get("state")!;
  const tokens = await oidc.authorizationCodeGrant(client, new URL(request.url), {
    expectedState: state, expectedNonce: transaction.nonce, pkceCodeVerifier: transaction.verifier, idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || claims.iss !== config.issuer || !claims.sub || claims.sub.length > 255) throw new Error("Invalid provider identity");
  // No email is used, stored, matched, or merged. Issuer + subject is the identity.
  const id = "usr_" + hash(JSON.stringify([claims.iss, claims.sub]));
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 300) : "";
  await db.batch([
    db.prepare("INSERT INTO private_users (id, name, kind) VALUES (?, ?, 'provider') ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(id, name),
    db.prepare("INSERT OR IGNORE INTO provider_identities (issuer, subject, user_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(claims.iss, claims.sub, id, now.toISOString()),
  ]);
  // The access/ID tokens and client secret are never saved in sessions or browser storage.
  return newSession(db, id, now, session, config.policy);
}
