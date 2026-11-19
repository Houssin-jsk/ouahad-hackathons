import type { Database } from "../local-d1.ts";
import type { ResendConfig } from "./config.ts";
import { attemptDelivery,enqueueEmail,type Delivery,type Envelope } from "./queue.ts";
import { reconcileUserReminders,renderReminder } from "../private/reminders.ts";
import { emailId,unseal } from "./crypto.ts";

export async function authorizeTransactionalEmail(db:Database,row:Delivery,envelope:Envelope,now:Date){
  if(row.kind!=="reminder")return Boolean(await db.prepare(`SELECT c.id FROM email_signin_challenges c JOIN private_sessions s ON s.token_hash=c.session_hash
    WHERE c.id=? AND c.transport='resend' AND c.purpose=? AND c.email=? AND c.used_at IS NULL AND c.attempts<5 AND c.expires_at>? AND s.expires_at>?
    AND ((c.purpose='signin' AND c.account_id IS NULL) OR (c.purpose='reminder-address' AND c.account_id=s.user_id AND c.account_id=?))`)
    .bind(row.challenge_id,row.kind,envelope.mail.to[0]!,now.toISOString(),now.toISOString(),row.user_id).first());
  if(!row.user_id)return false;
  const context=await reconcileUserReminders(db,row.user_id,now,"resend"),plan=context.rows.find((item)=>item.id===row.reminder_id);
  if(!plan||plan.generation!==row.generation||plan.state!=="pending"||plan.payload!==envelope.reminderPayload||!plan.due_at||plan.due_at>now.toISOString()||!plan.expires_at||plan.expires_at<=now.toISOString())return false;
  const guard=JSON.parse(plan.guard) as {settingsVersion:number;facts:string;intent:string;catalogId:string|null;approvedRevision:string|null};
  return Boolean(await db.prepare(`SELECT r.id FROM stage_reminders r
    JOIN email_reminder_settings s ON s.user_id=r.user_id JOIN private_entries e ON e.id=r.entry_id AND e.user_id=r.user_id
    JOIN private_stage_progress p ON p.entry_id=r.entry_id AND p.user_id=r.user_id AND p.stage_key=r.stage_key
    WHERE r.id=? AND r.user_id=? AND r.version=? AND r.generation=? AND r.state='pending'
    AND s.version=? AND s.reminders_enabled=1 AND s.delivery_email=? AND s.verified_at IS NOT NULL AND s.verification_kind='mailbox-code'
    AND p.decision='accepted' AND p.intent=? AND p.intent!='declined' AND p.attended=0 AND p.facts=?
    AND ((? IS NULL AND e.catalog_id IS NULL) OR (e.catalog_id=? AND EXISTS(SELECT 1 FROM editions d
      WHERE d.id=e.catalog_id AND d.publication_state='published' AND d.approved_revision_id=?)))`)
    .bind(plan.id,row.user_id,plan.version,row.generation,guard.settingsVersion,envelope.mail.to[0]!,guard.intent,guard.facts,guard.catalogId,guard.catalogId,guard.approvedRevision).first());
}
async function rolloutAllows(db:Database,config:ResendConfig,row:Delivery,envelope:Envelope){
  if(config.allowedKinds&&!config.allowedKinds.includes(row.kind))return false;
  if(config.ownerOnly&&(!envelope.mail.to.every(address=>config.ownerAddresses.includes(address))
    ||config.ownerUserIds&&(!row.user_id||!config.ownerUserIds.includes(row.user_id))))return false;
  return !config.googleOnly||Boolean(row.user_id&&await db.prepare("SELECT 1 FROM provider_identities WHERE user_id=? AND issuer='https://accounts.google.com'").bind(row.user_id).first());
}
export function dispatchTransactionalEmail(db:Database,config:ResendConfig,id:string,options:{now?:Date;fetcher?:typeof fetch;timeoutMs?:number;beforeAuthorize?:()=>Promise<void>}={}){
  return attemptDelivery(db,config,id,{...options,authorize:async(row,envelope,now)=>await rolloutAllows(db,config,row,envelope)&&await authorizeTransactionalEmail(db,row,envelope,now)});
}
export async function planLiveReminders(db:Database,config:ResendConfig,origin:string,now=new Date(),ownerOnly?:string[]){
  const users=(await db.prepare("SELECT DISTINCT user_id FROM private_stage_progress WHERE decision='accepted' UNION SELECT user_id FROM stage_reminders").all<{user_id:string}>()).results;
  const ids:string[]=[];
  for(const {user_id}of users){
    if(config.ownerOnly&&config.ownerUserIds&&!config.ownerUserIds.includes(user_id))continue;
    if(config.googleOnly&&!await db.prepare("SELECT 1 FROM provider_identities WHERE user_id=? AND issuer='https://accounts.google.com'").bind(user_id).first())continue;
    const context=await reconcileUserReminders(db,user_id,now,"resend");
    for(const row of context.rows){
      if(row.state!=="pending"||!row.due_at||row.due_at>now.toISOString()||!row.expires_at||row.expires_at<=now.toISOString())continue;
      const payload=JSON.parse(row.payload) as {recipient:string};if((ownerOnly&&!ownerOnly.includes(payload.recipient))||(config.ownerOnly&&!config.ownerAddresses.includes(payload.recipient)))continue;
      const rendered=renderReminder(row,origin,true);
      ids.push(await enqueueEmail(db,config,"reminder",emailId([row.id,row.generation,row.payload]),{to:[payload.recipient],subject:rendered.subject,text:rendered.body},new Date(row.expires_at),now,{user:user_id,reminder:row.id,generation:row.generation,reminderPayload:row.payload}));
    }
  }
  return ids;
}
export async function runTransactionalEmailJob(db:Database,config:ResendConfig,{now=new Date(),fetcher=fetch,origin="https://hackathons.ouahad.space",reminders=true,limit=20}:{now?:Date;fetcher?:typeof fetch;origin?:string;reminders?:boolean;limit?:number}={}){
  const started=Date.now(),clock=()=>new Date(now.getTime()+Date.now()-started);
  await db.prepare(`UPDATE email_deliveries SET state=CASE WHEN uncertain=1 THEN 'unknown' ELSE 'cancelled' END,
    error_code='expired',encrypted_payload=NULL,updated_at=? WHERE expires_at<=? AND state IN ('queued','retry_wait','quota_wait')`)
    .bind(now.toISOString(),now.toISOString()).run();
  if(reminders)await planLiveReminders(db,config,origin,now);
  const rows=(await db.prepare("SELECT id FROM email_deliveries WHERE state IN ('queued','retry_wait','quota_wait','sending') AND next_attempt_at<=? ORDER BY CASE WHEN kind='reminder' THEN 1 ELSE 0 END,created_at,id LIMIT ?").bind(now.toISOString(),Math.min(20,limit)).all<{id:string}>()).results;
  const results=[];for(const row of rows){
    if(config.allowedKinds){const kind=await db.prepare("SELECT kind FROM email_deliveries WHERE id=?").bind(row.id).first<Delivery["kind"]>("kind");if(!kind||!config.allowedKinds.includes(kind))continue;}
    if(config.ownerOnly){const cipher=await db.prepare("SELECT encrypted_payload FROM email_deliveries WHERE id=?").bind(row.id).first<string>("encrypted_payload");if(!cipher)continue;try{const mail=unseal<Envelope>(cipher,config.encryptionKey,row.id).mail;if(!mail.to.every((address)=>config.ownerAddresses.includes(address)))continue;}catch{continue;}}
    const pace=await db.prepare("SELECT next_request_at,blocked_until FROM email_transport_state WHERE id=1").first<{next_request_at:string|null;blocked_until:string|null}>();
    const current=clock(),delay=pace?.next_request_at?Date.parse(pace.next_request_at)-current.getTime():0;
    if(delay>0&&delay<=1000&&(!pace?.blocked_until||pace.blocked_until<=current.toISOString()))await new Promise<void>((resolve)=>setTimeout(resolve,delay+5));
    results.push({id:row.id,...await dispatchTransactionalEmail(db,config,row.id,{now:clock(),fetcher})});
  }return results;
}
