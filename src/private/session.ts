import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "../local-d1.ts";

export const identities = [{ id: "dev-aya", name: "Aya" }, { id: "dev-sami", name: "Sami" }] as const;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const sessionCookie = "ouahad_dev_session";
export type SessionPolicy = { mode: "demo" | "provider"; realm: string; secure: boolean };
const demoPolicy: SessionPolicy = { mode: "demo", realm: "demo", secure: false };
export type Session = { token_hash: string; user_id: string | null; csrf: string; expires_at: string; name?: string; mode?: "demo" | "provider" };
export const cookieName = (policy: SessionPolicy) => policy.mode === "demo" ? sessionCookie
  : policy.secure ? "__Host-ouahad_session" : "ouahad_provider_session";
export const cookie = (token: string, policy = demoPolicy, maxAge = 28800) => `${cookieName(policy)}=${token}; Path=/; HttpOnly; SameSite=${policy.mode === "demo" ? "Strict" : "Lax"}; Max-Age=${maxAge}${policy.secure ? "; Secure" : ""}`;
export const clearCookie = cookie("", demoPolicy, 0);
export const readCookie = (header: string | undefined | null, name: string) => {
  const values = header?.split(";").map((part) => part.trim()).filter((part) => part.startsWith(name + "="));
  return values?.length === 1 ? values[0]!.slice(name.length + 1) : undefined;
};

export async function findSession(db: Database, header: string | undefined | null, now: Date, policy = demoPolicy) {
  const token = readCookie(header, cookieName(policy));
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.prepare(`SELECT s.*, u.name FROM private_sessions s LEFT JOIN private_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND s.realm = ? AND (s.user_id IS NULL OR u.kind = ?)`)
    .bind(hash(token), now.toISOString(), policy.realm, policy.mode).first<Session>();
  return session ? { ...session, mode: policy.mode } : null;
}

export async function newSession(db: Database, userId: string | null, now: Date, previous?: Session | null, policy = demoPolicy) {
  if (userId && (policy.mode === "demo" ? !identities.some((item) => item.id === userId) : !userId.startsWith("usr_"))) {
    throw new Error("Invalid session account kind");
  }
  const token = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex");
  const tokenHash = hash(token), expires = new Date(now.getTime() + 8 * 3600_000).toISOString();
  const changes = await db.batch([
    db.prepare("DELETE FROM private_sessions WHERE expires_at <= ?").bind(now.toISOString()),
    ...(policy.mode === "demo" ? identities.map((user) => db.prepare("INSERT OR IGNORE INTO private_users (id, name, kind) VALUES (?, ?, 'demo')")
      .bind(user.id, user.name)) : []),
    db.prepare(`INSERT INTO private_sessions (token_hash, user_id, csrf, expires_at, realm)
      SELECT ?, ?, ?, ?, ? WHERE (? IS NULL OR EXISTS (SELECT 1 FROM private_users WHERE id = ? AND kind = ?))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM private_sessions WHERE token_hash = ? AND realm = ? AND expires_at > ?))`)
      .bind(tokenHash, userId, csrf, expires, policy.realm, userId, userId, policy.mode,
        previous?.token_hash ?? null, previous?.token_hash ?? null, policy.realm, now.toISOString()),
    db.prepare("DELETE FROM private_sessions WHERE token_hash = ? AND EXISTS (SELECT 1 FROM private_sessions WHERE token_hash = ?)")
      .bind(previous?.token_hash ?? "", tokenHash),
  ]);
  // A logout during the provider exchange fences the old login; it cannot revive a revoked session.
  if (changes.at(-2)?.meta.changes !== 1) throw new Error("Session is no longer valid");
  const name = userId ? await db.prepare("SELECT name FROM private_users WHERE id = ?").bind(userId).first<string>("name") : undefined;
  return { setCookie: cookie(token, policy), session: { token_hash: tokenHash, user_id: userId, csrf, expires_at: expires, name: name ?? undefined, mode: policy.mode } };
}

export function validCsrf(session: Session, value: string) {
  const expected = new TextEncoder().encode(session.csrf), actual = new TextEncoder().encode(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
