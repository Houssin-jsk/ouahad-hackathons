import { enqueueEmail } from "../email/queue.ts";
import { dispatchTransactionalEmail } from "../email/service.ts";
import { codeMail } from "../email/copy.ts";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "../local-d1.ts";
import type { ProviderConfig } from "./auth-config.ts";
import { hash, newSession, type Session } from "./session.ts";

const emailInput = z.email().max(254);
const digest = (session: Session, id: string, code: string) => createHmac("sha256", session.csrf).update(id + ":" + code).digest("hex");
export type CodePurpose = "signin" | "reminder-address";
export async function requestEmailCode(db: Database, config: ProviderConfig, session: Session, address: string, next: string, now: Date, purpose:CodePurpose="signin",language:"en"|"fr"|"ar"="en",deliveryOptions:{fetcher?:typeof fetch;timeoutMs?:number}={}) {
  if (!config.emailLive && (!config.emailCapture || config.policy.secure)) throw new Error("Email sign-in disabled");
  if(purpose==="reminder-address"&&!session.user_id)throw new Error("Account required");
  const email = emailInput.parse(address.trim().toLowerCase());
  if(config.emailLive?.ownerOnly&&!config.emailLive.ownerAddresses.includes(email))throw new Error("Owner-controlled address required");
  // No account existence lookup: new and returning addresses take the same path.
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString(), minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const limits = await db.batch(["email:" + hash(email), "session:" + session.token_hash].map((key) => db.prepare(`
    INSERT INTO email_request_limits (key,window_start,last_sent,count) VALUES (?,?,?,1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END, last_sent = excluded.last_sent
    WHERE last_sent <= ? AND (window_start <= ? OR count < 5)`)
    .bind(key, now.toISOString(), now.toISOString(), hourAgo, hourAgo, minuteAgo, hourAgo)));
  if (limits.some((result) => result.meta.changes !== 1)) return { status: "limited" as const };
  const id = randomUUID(), code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.batch([
    db.prepare("DELETE FROM email_signin_challenges WHERE expires_at <= ? OR (session_hash = ? AND purpose = ? AND transport = ?)").bind(now.toISOString(), session.token_hash,purpose,config.emailLive?"resend":"capture"),
    db.prepare(`INSERT INTO email_signin_challenges (id,session_hash,email,code_hash,return_path,expires_at,purpose,account_id,transport) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id, session.token_hash, email, digest(session, id, code), next, new Date(now.getTime() + 600_000).toISOString(),purpose,purpose==="signin"?null:session.user_id,config.emailLive?"resend":"capture"),
    ...(!config.emailLive?[db.prepare("INSERT INTO local_email_outbox VALUES (?,?,?)").bind(id, code, now.toISOString())]:[]),
    db.prepare("DELETE FROM email_request_limits WHERE last_sent < ?").bind(hourAgo),
  ]);
  if(config.emailLive){
    const mail=codeMail(code,purpose,language);
    const deliveryId=await enqueueEmail(db,config.emailLive,purpose,id,{to:[email],...mail},new Date(now.getTime()+600_000),now,{challenge:id,user:purpose==="signin"?null:session.user_id});
    await dispatchTransactionalEmail(db,config.emailLive,deliveryId,{now,...deliveryOptions});
  }
  return { status: "created" as const, id };
}

export async function emailChallenge(db: Database, session: Session, id: string, now: Date, contextOnly=false, purpose:CodePurpose="signin",transport="capture") {
  return db.prepare(`SELECT id,email,return_path,expires_at FROM email_signin_challenges
    WHERE id=? AND session_hash=? AND purpose=? AND account_id IS ? AND transport=? AND used_at IS NULL AND (?=1 OR (expires_at > ? AND attempts < 5))`)
    .bind(id, session.token_hash,purpose,purpose==="signin"?null:session.user_id,transport, Number(contextOnly), now.toISOString()).first<{ id: string; email: string; return_path: string; expires_at: string }>();
}
export async function capturedCode(db: Database, session: Session, id: string, now: Date, purpose:CodePurpose="signin") {
  return db.prepare(`SELECT c.email,o.code,o.created_at,c.expires_at FROM local_email_outbox o
    JOIN email_signin_challenges c ON c.id=o.challenge_id WHERE c.id=? AND c.session_hash=?
    AND c.transport='capture' AND c.purpose=? AND c.account_id IS ? AND c.used_at IS NULL AND c.expires_at > ? AND c.attempts < 5`)
    .bind(id,session.token_hash,purpose,purpose==="signin"?null:session.user_id,now.toISOString()).first<{ email: string; code: string; created_at: string; expires_at: string }>();
}
export async function consumeEmailCode(db: Database, config: ProviderConfig, session: Session, id: string, code: string, now: Date, purpose:CodePurpose) {
  if (!config.emailLive && (!config.emailCapture || config.policy.secure)) throw new Error("Email sign-in disabled");
  const challenge = await db.prepare(`UPDATE email_signin_challenges SET attempts=attempts+1
    WHERE id=? AND session_hash=? AND purpose=? AND account_id IS ? AND transport=? AND used_at IS NULL AND expires_at > ? AND attempts < 5
    RETURNING email,code_hash,return_path`).bind(id,session.token_hash,purpose,purpose==="signin"?null:session.user_id,config.emailLive?"resend":"capture",now.toISOString())
    .first<{ email: string; code_hash: string; return_path: string }>();
  if (!challenge || !/^\d{6}$/.test(code)) return null;
  const expected = new TextEncoder().encode(challenge.code_hash), actual = new TextEncoder().encode(digest(session,id,code));
  if (!timingSafeEqual(expected,actual)) return null;
  const used = await db.prepare(`UPDATE email_signin_challenges SET used_at=? WHERE id=? AND session_hash=? AND purpose=? AND account_id IS ? AND transport=? AND used_at IS NULL AND expires_at > ?`)
    .bind(now.toISOString(),id,session.token_hash,purpose,purpose==="signin"?null:session.user_id,config.emailLive?"resend":"capture",now.toISOString()).run();
  if (used.meta.changes !== 1) return null;
  return challenge;
}
export async function verifyEmailCode(db: Database, config: ProviderConfig, session: Session, id: string, code: string, now: Date) {
  const challenge=await consumeEmailCode(db,config,session,id,code,now,"signin");
  if(!challenge)return null;
  const candidate = "usr_" + randomUUID(),table=config.emailLive?"live_email_identities":"email_identities";
  await db.batch([
    db.prepare(`INSERT INTO private_users (id,name,kind) SELECT ?,?,'provider' WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE email=?)`)
      .bind(candidate,challenge.email,challenge.email),
    db.prepare(`INSERT OR IGNORE INTO ${table}(email,user_id,verified_at)
      SELECT ?,id,? FROM private_users WHERE id=?`).bind(challenge.email,now.toISOString(),candidate),
  ]);
  const user = await db.prepare(`SELECT user_id FROM ${table} WHERE email=?`).bind(challenge.email).first<string>("user_id");
  if (!user) throw new Error("Email identity missing");
  return { ...await newSession(db,user,now,session,config.policy), next: challenge.return_path };
}
