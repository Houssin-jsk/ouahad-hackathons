import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { openRemoteD1 } from "../src/remote-d1.ts";

// Explicit owner operation. Does not send, deploy, change proofs or print any secret value.
const database = process.argv[2];
if (!database || process.argv.length !== 3) throw new Error("Pass the explicit production D1 UUID");
const path = ".local/production-email-secrets.json";
try {
  await readFile(path);
  console.log("Existing production email secret file preserved. No values displayed or overwritten.");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  const local = parseEnv(await readFile(".env.email.local", "utf8"));
  if (!local.RESEND_API_KEY || !local.EMAIL_OWNER_ADDRESSES) throw new Error("Configure the ignored local email file first");
  const remote = await openRemoteD1(database);
  try {
    const jobs = await remote.db.prepare("SELECT count(*) AS n FROM email_deliveries WHERE encrypted_payload IS NOT NULL").first<number>("n");
    if (jobs) throw new Error("Existing encrypted jobs: restore the original production encryption key instead of generating another");
    const users = (await remote.db.prepare("SELECT user_id FROM provider_identities WHERE issuer='https://accounts.google.com'").all<{user_id:string}>()).results;
    if (users.length !== 1) throw new Error("Owner selection required: do not infer the owner among multiple Google accounts");
    await mkdir(".local", { recursive: true });
    await writeFile(path, JSON.stringify({ RESEND_API_KEY: local.RESEND_API_KEY,
      EMAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), EMAIL_OWNER_ADDRESSES: local.EMAIL_OWNER_ADDRESSES,
      EMAIL_OWNER_USER_IDS: users[0]!.user_id }), { mode: 0o600, flag: "wx" });
    console.log("Prepared ignored production email secrets for the existing owner account. No values displayed.");
  } finally { await remote.close(); }
}
