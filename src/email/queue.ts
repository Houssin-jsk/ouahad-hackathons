import { randomUUID } from "node:crypto";
import type { Database } from "../local-d1.ts";
import type { ResendConfig } from "./config.ts";
import { emailId,seal,unseal } from "./crypto.ts";
import { sendResend,type Mail } from "./resend.ts";
export type Delivery={id:string;kind:"signin"|"reminder-address"|"reminder";user_id:string|null;challenge_id:string|null;reminder_id:string|null;generation:number|null;encrypted_payload:string|null;state:string;attempts:number;uncertain:number;next_attempt_at:string;first_attempt_at:string|null;expires_at:string;provider_id:string|null;accepted_at:string|null;error_code:string|null;created_at:string;updated_at:string};
export type Envelope={mail:Mail;reminderPayload?:string};
export async function enqueueEmail(db:Database,config:ResendConfig,kind:Delivery["kind"],identity:string,mail:Omit<Mail,"from">,expires:Date,now:Date,refs:{user?:string|null;challenge?:string;reminder?:string;generation?:number;reminderPayload?:string}={}){
  const id=emailId(["resend-v1",kind,identity]);
  const envelope:Envelope={mail:{from:config.from,...mail},...(refs.reminderPayload?{reminderPayload:refs.reminderPayload}:{})};
  await db.prepare(`INSERT OR IGNORE INTO email_deliveries(id,kind,user_id,challenge_id,reminder_id,generation,encrypted_payload,next_attempt_at,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,kind,refs.user??null,refs.challenge??null,refs.reminder??null,refs.generation??null,seal(envelope,config.encryptionKey,id),now.toISOString(),expires.toISOString(),now.toISOString(),now.toISOString()).run();
  // A never-attempted cancelled plan may become eligible again (e.g. attendance changed
  // back to Going). Reuse its logical ID. Ambiguous attempted messages require review.
  await db.prepare("UPDATE email_deliveries SET state='queued',encrypted_payload=?,error_code=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND state='cancelled' AND attempts=0 AND expires_at>?")
    .bind(seal(envelope,config.encryptionKey,id),now.toISOString(),now.toISOString(),id,now.toISOString()).run();
  return id;
}
export async function deliveryStatus(db:Database,id:string){return db.prepare("SELECT id,kind,state,attempts,next_attempt_at,provider_id,accepted_at,error_code FROM email_deliveries WHERE id=?").bind(id).first<Pick<Delivery,"id"|"kind"|"state"|"attempts"|"next_attempt_at"|"provider_id"|"accepted_at"|"error_code">>();}
export async function ownerDeliveries(db:Database,user:string){return (await db.prepare("SELECT id,kind,reminder_id,generation,state,attempts,next_attempt_at,provider_id,accepted_at,error_code,created_at FROM email_deliveries WHERE user_id=? ORDER BY created_at DESC,id").bind(user).all<Delivery>()).results;}
export async function codeDeliveryAvailable(db:Database,now=new Date()){
  const time=now.toISOString(),state=await db.prepare("SELECT blocked_until FROM email_transport_state WHERE id=1").first<{blocked_until:string|null}>();
  if(state?.blocked_until&&state.blocked_until>time)return false;
  const counts=await db.batch(["day:"+time.slice(0,10),"month:"+time.slice(0,7)].map((bucket)=>db.prepare("SELECT count(*) AS n FROM email_budget_reservations WHERE bucket=? AND lane='codes'").bind(bucket)));
  return Number((counts[0]?.results[0] as {n?:number}|undefined)?.n??0)<80&&Number((counts[1]?.results[0] as {n?:number}|undefined)?.n??0)<2400;
}
const limits={codes:{day:80,month:2400},reminders:{day:20,month:600}} as const;
export async function attemptDelivery(db:Database,config:ResendConfig,id:string,{now=new Date(),fetcher=fetch,timeoutMs=8000,authorize,beforeAuthorize}: {
  now?:Date;fetcher?:typeof fetch;timeoutMs?:number;
  authorize:(row:Delivery,envelope:Envelope,now:Date)=>Promise<boolean>;beforeAuthorize?:()=>Promise<void>;
}){
  const time=now.toISOString(),lease=randomUUID();
  const lock=await db.prepare(`UPDATE email_transport_state SET owner=?,lease_until=? WHERE id=1
    AND (lease_until IS NULL OR lease_until<=?) AND (next_request_at IS NULL OR next_request_at<=?)
    AND (blocked_until IS NULL OR blocked_until<=?)`).bind(lease,new Date(now.getTime()+30_000).toISOString(),time,time,time).run();
  if(lock.meta.changes!==1)return {state:"deferred",code:"provider_busy_or_quota"};
  try{
    let row=await db.prepare("SELECT * FROM email_deliveries WHERE id=?").bind(id).first<Delivery>();
    if(!row||!["queued","retry_wait","quota_wait","sending"].includes(row.state)||row.next_attempt_at>time)return {state:row?.state??"missing"};
    const finish=async(state:string,code:string)=>{await db.prepare("UPDATE email_deliveries SET state=?,error_code=?,encrypted_payload=NULL,updated_at=? WHERE id=?").bind(state,code,time,id).run();return {state,code};};
    if(row.expires_at<=time)return finish(row.uncertain?"unknown":"cancelled","expired");
    if(row.attempts>=3||row.first_attempt_at&&now.getTime()-Date.parse(row.first_attempt_at)>=23*3600_000)return finish(row.uncertain?"unknown":"failed","retry_window_ended");
    if(row.kind==="reminder"&&await db.prepare("SELECT id FROM email_deliveries WHERE kind!='reminder' AND state IN ('queued','retry_wait','quota_wait','sending') AND next_attempt_at<=? AND expires_at>? LIMIT 1").bind(time,time).first())return {state:"deferred",code:"codes_priority"};
    let envelope:Envelope;try{envelope=unseal<Envelope>(row.encrypted_payload!,config.encryptionKey,id);}catch{return finish("failed","payload_unavailable");}
    const lane=row.kind==="reminder"?"reminders":"codes",day="day:"+time.slice(0,10),month="month:"+time.slice(0,7);
    // All outbound attempts share the D1 lease. Reserve BOTH calendar buckets before network I/O.
    for(const [bucket,limit]of [[day,limits[lane].day],[month,limits[lane].month]] as const){
      const used=await db.prepare("SELECT count(*) AS n FROM email_budget_reservations WHERE bucket=? AND lane=?").bind(bucket,lane).first<number>("n");
      const reserved=await db.prepare("SELECT delivery_id FROM email_budget_reservations WHERE delivery_id=? AND bucket=?").bind(id,bucket).first();
      if(!reserved&&(used??0)>=limit){await db.prepare("UPDATE email_deliveries SET state='quota_wait',error_code='local_budget',next_attempt_at=?,updated_at=? WHERE id=?").bind(nextBucket(now,bucket.startsWith("month:")),time,id).run();return {state:"quota_wait",code:"local_budget"};}
    }
    await beforeAuthorize?.();
    if(!await authorize(row,envelope,now))return finish(row.uncertain?"unknown":"cancelled","no_longer_current");
    await db.batch([...[day,month].map((bucket)=>db.prepare("INSERT OR IGNORE INTO email_budget_reservations VALUES(?,?,?)").bind(id,bucket,lane)),
      db.prepare("UPDATE email_deliveries SET state='sending',uncertain=1,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=?").bind(time,time,id),
      db.prepare("UPDATE email_transport_state SET next_request_at=? WHERE id=1 AND owner=?").bind(new Date(now.getTime()+1000).toISOString(),lease)]);
    const result=await sendResend(config,"ouahad/"+id,envelope.mail,{fetcher,timeoutMs});
    if(result.state==="provider_accepted"){
      await db.prepare("UPDATE email_deliveries SET state='provider_accepted',provider_id=?,accepted_at=?,encrypted_payload=NULL,error_code=NULL,updated_at=? WHERE id=?").bind(result.providerId,time,time,id).run();
      return {state:result.state,providerId:result.providerId};
    }
    if(result.state==="failed"){
      if(result.code==="provider_configuration")await db.prepare("UPDATE email_transport_state SET blocked_until=?,blocked_reason=? WHERE id=1").bind(new Date(now.getTime()+15*60_000).toISOString(),result.code).run();
      return finish(row.uncertain?"unknown":"failed",result.code);
    }
    const attempts=row.attempts+1;
    if(attempts>=3)return finish(row.uncertain||result.ambiguous?"unknown":"failed","retry_exhausted");
    let next=new Date(now.getTime()+Math.max(5*2**(attempts-1),result.retryAfterSeconds??0)*1000).toISOString();
    if(result.state==="quota_wait"){
      next=nextBucket(now,result.code==="monthly_quota_exceeded");
      await db.prepare("UPDATE email_transport_state SET blocked_until=?,blocked_reason=? WHERE id=1").bind(next,result.code).run();
    }
    if(result.state==="retry_wait")await db.prepare("UPDATE email_transport_state SET blocked_until=?,blocked_reason=? WHERE id=1").bind(next,result.code).run();
    await db.prepare("UPDATE email_deliveries SET state=?,error_code=?,next_attempt_at=?,updated_at=?,uncertain=? WHERE id=?").bind(result.state,result.code,next,time,Number(Boolean(row.uncertain||result.ambiguous)),id).run();
    return {state:result.state,code:result.code};
  }finally{await db.prepare("UPDATE email_transport_state SET owner=NULL,lease_until=NULL WHERE id=1 AND owner=?").bind(lease).run();}
}
function nextBucket(now:Date,month:boolean){return month?new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString():new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)).toISOString();}
