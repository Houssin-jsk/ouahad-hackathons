import { deliveryText } from "../email/copy.ts";
import { ownerDeliveries, type Delivery } from "../email/queue.ts";
import { createHash } from "node:crypto";
import type { Database } from "../local-d1.ts";
import { privateEntries, type PrivateEntry, type TrackedStage } from "./entries.ts";
import { fromDateControls } from "./stage-form.ts";
import { dateAt } from "../model.ts";
import { reminderDate, reminderText, type ReminderLanguage } from "./reminder-copy.ts";

const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type EmailSettings={user_id:string;reminders_enabled:number;language:ReminderLanguage;delivery_email:string|null;verified_at:string|null;verification_kind:"captured-local"|"mailbox-code"|null;version:number;updated_at:string};
type Guard={settingsVersion:number;facts:string;intent:string;catalogId:string|null;approvedRevision:string|null};
type Payload={title:string;stage:string;start:string|null;end:string|null;zone:string|null;recipient:string|null;language:ReminderLanguage};
export type StageReminder={id:string;user_id:string;entry_id:string;stage_key:string;schedule_hash:string;generation:number;kind:"reminder"|"schedule-change";due_at:string|null;expires_at:string|null;state:"pending"|"cancelled"|"captured"|"waiting";reason:string|null;payload:string;guard:string;version:number;updated_at:string};
export type ReminderMessage={id:string;reminder_id:string;generation:number;user_id:string;kind:"reminder"|"schedule-change";recipient:string;subject:string;body:string;language:ReminderLanguage;captured_at:string};
export type ReminderContext={ownerOnly?:boolean;settings:EmailSettings;rows:StageReminder[];messages:ReminderMessage[];captureAvailable:boolean;liveAvailable?:boolean;deliveries?:Delivery[]};

export async function getEmailSettings(db:Database,user:string,now=new Date(),language:ReminderLanguage="en"){
  // Only this internal identity's verified email can seed an address. Never match Google names or email strings.
  await db.prepare(`INSERT OR IGNORE INTO email_reminder_settings(user_id,language,delivery_email,verified_at,verification_kind,updated_at)
    SELECT u.id,?,COALESCE(l.email,e.email),COALESCE(l.verified_at,e.verified_at),CASE WHEN l.email IS NOT NULL THEN 'mailbox-code' WHEN e.email IS NOT NULL THEN 'captured-local' END,?
    FROM private_users u LEFT JOIN email_identities e ON e.user_id=u.id LEFT JOIN live_email_identities l ON l.user_id=u.id WHERE u.id=?`)
    .bind(language,now.toISOString(),user).run();
  const row=await db.prepare("SELECT * FROM email_reminder_settings WHERE user_id=?").bind(user).first<EmailSettings>();
  if(!row)throw new Error("Unknown reminder account");return row;
}
export function hasDeliveryAddress(settings:EmailSettings,captureAvailable:boolean|"resend"){return Boolean(captureAvailable&&settings.delivery_email&&settings.verified_at&&settings.verification_kind===(captureAvailable==="resend"?"mailbox-code":"captured-local"));}
export async function setReminderPreferences(db:Database,user:string,enabled:boolean,language:ReminderLanguage,captureAvailable:boolean|"resend",now=new Date()){
  if(!["en","fr","ar"].includes(language))throw new Error("Invalid reminder language");
  const current=await getEmailSettings(db,user,now,language);
  if(enabled&&!hasDeliveryAddress(current,captureAvailable))return false;
  const result=await db.prepare(`UPDATE email_reminder_settings SET reminders_enabled=?,language=?,version=version+1,updated_at=?
    WHERE user_id=? AND version=?`).bind(Number(enabled),language,now.toISOString(),user,current.version).run();
  return result.meta.changes===1;
}
export async function setVerifiedReminderAddress(db:Database,user:string,email:string,now=new Date(),transport:"capture"|"resend"="capture"){
  await getEmailSettings(db,user,now);
  await db.prepare(`UPDATE email_reminder_settings SET delivery_email=?,verified_at=?,verification_kind=?,
    reminders_enabled=0,version=version+1,updated_at=? WHERE user_id=?`).bind(email,now.toISOString(),transport==="resend"?"mailbox-code":"captured-local",now.toISOString(),user).run();
}

function dayBoundary(day:string,zone:string){
  let lo=Date.parse(day)-25*3600_000,hi=Date.parse(day)+25*3600_000;
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(dateAt(new Date(mid),zone)<day)lo=mid;else hi=mid;}return hi;
}
export function reminderTiming(start:string|null,zone:string|null){
  if(!start)return null;
  if(start.includes("T")){const instant=Date.parse(start);return {due:new Date(instant-24*3600_000).toISOString(),expires:new Date(instant).toISOString()};}
  const prior=new Date(Date.parse(start)-86400_000).toISOString().slice(0,10),sourceZone=zone??"Africa/Casablanca";
  try{return {due:fromDateControls(prior,"09:00",sourceZone,"first")!,expires:new Date(dayBoundary(start,sourceZone)).toISOString()};}catch{return null;}
}
type SourceGuard={entry_id:string;stage_key:string;facts:string;catalog_id:string|null;approved_revision_id:string|null;publication_state:string|null};
async function sourceGuards(db:Database,user:string){
  return (await db.prepare(`SELECT e.id AS entry_id,p.stage_key,p.facts,e.catalog_id,d.approved_revision_id,d.publication_state
    FROM private_entries e JOIN private_stage_progress p ON p.entry_id=e.id AND p.user_id=e.user_id
    LEFT JOIN editions d ON d.id=e.catalog_id WHERE e.user_id=? ORDER BY e.id,p.stage_key`).bind(user).all<SourceGuard>()).results;
}
function cancellation(stage:TrackedStage,settings:EmailSettings,timing:ReturnType<typeof reminderTiming>,capture:boolean|"resend",now:Date){
  if(stage.unavailable)return "unavailable";
  if(stage.decision!=="accepted")return "not-accepted";
  if(stage.intent==="declined")return "declined";
  if(stage.attended)return "attended";
  if(!hasDeliveryAddress(settings,capture))return "email";
  if(!settings.reminders_enabled)return "opt-out";
  if(!timing)return "dates";
  if(timing.expires<=now.toISOString())return "past";
  return null;
}
export async function reminderMessages(db:Database,user:string,id?:string){
  return (await db.prepare("SELECT * FROM reminder_outbox WHERE user_id=? AND (? IS NULL OR id=?) ORDER BY captured_at DESC,id")
    .bind(user,id??null,id??null).all<ReminderMessage>()).results;
}
export async function reconcileUserReminders(db:Database,user:string,now=new Date(),captureAvailable:boolean|"resend"=false,language:ReminderLanguage="en"):Promise<ReminderContext>{
  const settings=await getEmailSettings(db,user,now,language);
  // Bracket the multi-query agenda read with a coherent source snapshot. Never attach a
  // newer revision/facts guard to older dates if an approval or private edit races this read.
  let entries:PrivateEntry[]=[],guards:SourceGuard[]=[],stable=false;
  for(let attempt=0;attempt<3;attempt++){
    guards=await sourceGuards(db,user);entries=await privateEntries(db,user,now);
    if(JSON.stringify(guards)===JSON.stringify(await sourceGuards(db,user))){stable=true;break;}
  }
  const messages=captureAvailable==="resend"?[]:await reminderMessages(db,user);
  const deliveries=captureAvailable==="resend"?await ownerDeliveries(db,user):[];
  const existing=(await db.prepare("SELECT * FROM stage_reminders WHERE user_id=?").bind(user).all<StageReminder>()).results;
  for(const entry of stable?entries:[])for(const stage of entry.stages){
    const old=existing.find((row)=>row.entry_id===entry.id&&row.stage_key===stage.key);
    if(stage.decision!=="accepted"&&!old)continue;
    const id=digest([user,entry.id,stage.key]),scheduleHash=digest(["timing-v1",stage.eventStart,stage.eventEnd,stage.timeZone]);
    const changed=Boolean(old&&old.schedule_hash!==scheduleHash),generation=old?old.generation+Number(changed):1;
    const history=[...messages,...deliveries.filter((item)=>item.state==="provider_accepted")].filter((message)=>message.reminder_id===id),captured=history.some((message)=>message.generation===generation);
    const kind=changed&&history.length?"schedule-change":!changed&&old?old.kind:"reminder";
    const timing=reminderTiming(stage.eventStart,stage.timeZone),reason=cancellation(stage,settings,timing,captureAvailable,now);
    const due=kind==="schedule-change"?(changed||!old?now.toISOString():old.due_at):timing?.due??null;
    const state=captured&&reason==="past"?"captured":reason?(reason==="email"||reason==="dates"?"waiting":"cancelled"):captured?"captured":"pending";
    const payload:Payload={title:entry.title,stage:stage.name,start:stage.eventStart,end:stage.eventEnd,zone:stage.timeZone,recipient:settings.delivery_email,language:settings.language};
    const source=guards.find((item)=>item.entry_id===entry.id&&item.stage_key===stage.key);
    if(!source)continue;
    const guard:Guard={settingsVersion:settings.version,facts:source.facts,intent:stage.intent,catalogId:entry.catalogId,approvedRevision:source.approved_revision_id};
    const values=[scheduleHash,generation,kind,due,timing?.expires??null,state,reason,JSON.stringify(payload),JSON.stringify(guard)];
    const unchanged=old&&JSON.stringify([old.schedule_hash,old.generation,old.kind,old.due_at,old.expires_at,old.state,old.reason,old.payload,old.guard])===JSON.stringify(values);
    if(unchanged)continue;
    if(old){await db.prepare(`UPDATE stage_reminders SET schedule_hash=?,generation=?,kind=?,due_at=?,expires_at=?,state=?,reason=?,payload=?,guard=?,version=version+1,updated_at=?
      WHERE id=? AND user_id=? AND version=?`).bind(...values,now.toISOString(),id,user,old.version).run();}
    else await db.prepare(`INSERT OR IGNORE INTO stage_reminders(id,user_id,entry_id,stage_key,schedule_hash,generation,kind,due_at,expires_at,state,reason,payload,guard,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,user,entry.id,stage.key,...values,now.toISOString()).run();
  }
  const rows=(await db.prepare("SELECT * FROM stage_reminders WHERE user_id=?").bind(user).all<StageReminder>()).results;
  if(captureAvailable==="resend")for(const row of rows){
    const currentId=digest(["resend-v1","reminder",digest([row.id,row.generation,row.payload])]);
    await db.prepare(`UPDATE email_deliveries SET state=CASE WHEN uncertain=1 THEN 'unknown' ELSE 'cancelled' END,error_code='no_longer_current',encrypted_payload=NULL,updated_at=?
      WHERE user_id=? AND reminder_id=? AND state IN ('queued','retry_wait','quota_wait') AND (id!=? OR ?!='pending')`)
      .bind(now.toISOString(),user,row.id,currentId,row.state).run();
  }
  return {settings,rows,messages,captureAvailable:captureAvailable===true,liveAvailable:captureAvailable==="resend",deliveries:captureAvailable==="resend"?await ownerDeliveries(db,user):deliveries};
}

export function renderReminder(row:StageReminder,origin:string,live=false){
  const p=JSON.parse(row.payload) as Payload,t=reminderText[p.language];
  const isolate=(value:string)=>p.language==="ar"?"\u2068"+value+"\u2069":value;
  const dates=[p.start,p.end].filter((value,index,array)=>value&&(index===0||value!==array[0])).map((value)=>reminderDate(value!,p.language)).join(" — ");
  const url=new URL(`/my/entries/${row.entry_id}`,origin);if(p.language!=="en")url.searchParams.set("lang",p.language);url.hash="stage-"+row.stage_key;
  const settings=new URL("/my/email-settings",origin);if(p.language!=="en")settings.searchParams.set("lang",p.language);
  return {subject:`${row.kind==="schedule-change"?t.changeSubject:t.subject}: ${isolate(p.stage)} — ${isolate(p.title)}`.replace(/[\r\n]+/g," "),
    body:[row.kind==="schedule-change"?(live?deliveryText[p.language].scheduleChange:t.changeCopy):t.acceptedCopy,`${t.opportunity}: ${isolate(p.title)}`,`${t.event}: ${isolate(p.stage)}`,`${t.eventDates}: ${isolate(dates)}`,
      p.start&&!p.start.includes("T")?t.startUnknown:"",p.start?.includes("T")?t.exactPolicy:t.datePolicy,
      `${t.view}: ${isolate(url.href)}`,`${t.manage}: ${isolate(settings.href)}`,live?"":t.local].filter(Boolean).join("\n\n")};
}

export async function runReminderJob(db:Database,{now=new Date(),capture=false,origin="http://127.0.0.1:4177",beforeCapture}: {
  now?:Date;capture?:boolean;origin?:string;beforeCapture?:(row:StageReminder)=>Promise<void>;
}={}){
  // This function has no network sender. Capture is an explicit local caller capability.
  if(!capture)throw new Error("Only the local reminder capture transport is implemented");
  const url=new URL(origin);if(url.protocol!=="http:"||!["localhost","127.0.0.1"].includes(url.hostname))throw new Error("Local reminder origin required");
  const users=(await db.prepare(`SELECT DISTINCT user_id FROM private_stage_progress WHERE decision='accepted'
    UNION SELECT user_id FROM stage_reminders UNION SELECT user_id FROM email_reminder_settings`).all<{user_id:string}>()).results;
  for(const {user_id} of users)await reconcileUserReminders(db,user_id,now,true);
  const candidates=(await db.prepare("SELECT * FROM stage_reminders WHERE state='pending' AND due_at<=? AND expires_at>? ORDER BY due_at,id")
    .bind(now.toISOString(),now.toISOString()).all<StageReminder>()).results;
  let captured=0,staleSkipped=0;
  for(const candidate of candidates){
    // Reload approved/private facts, consent, recipient and attendance immediately before capture.
    const current=await reconcileUserReminders(db,candidate.user_id,now,true),row=current.rows.find((item)=>item.id===candidate.id);
    if(!row||row.state!=="pending"||!row.due_at||row.due_at>now.toISOString()||!row.expires_at||row.expires_at<=now.toISOString())continue;
    const guard=JSON.parse(row.guard) as Guard,payload=JSON.parse(row.payload) as Payload,message=renderReminder(row,origin),outboxId=digest([row.id,row.generation]);
    await beforeCapture?.(row);
    // The final guard is inside the same D1 transaction as the outbox insert. A concurrent
    // decline, opt-out, withdrawal, address change or approval cannot slip through the recheck.
    const results=await db.batch([
      db.prepare(`INSERT OR IGNORE INTO reminder_outbox(id,reminder_id,generation,user_id,kind,recipient,subject,body,language,captured_at)
        SELECT ?,r.id,r.generation,r.user_id,r.kind,?,?,?,?,? FROM stage_reminders r
        JOIN email_reminder_settings s ON s.user_id=r.user_id
        JOIN private_entries e ON e.id=r.entry_id AND e.user_id=r.user_id
        JOIN private_stage_progress p ON p.entry_id=r.entry_id AND p.user_id=r.user_id AND p.stage_key=r.stage_key
        WHERE r.id=? AND r.user_id=? AND r.version=? AND r.generation=? AND r.state='pending' AND r.due_at<=? AND r.expires_at>?
        AND s.version=? AND s.reminders_enabled=1 AND s.delivery_email=? AND s.verified_at IS NOT NULL AND s.verification_kind='captured-local'
        AND p.decision='accepted' AND p.intent=? AND p.intent!='declined' AND p.attended=0 AND p.facts=?
        AND ((? IS NULL AND e.catalog_id IS NULL) OR (e.catalog_id=? AND EXISTS
          (SELECT 1 FROM editions d WHERE d.id=e.catalog_id AND d.publication_state='published' AND d.approved_revision_id=?)))`)
        .bind(outboxId,payload.recipient!,message.subject,message.body,payload.language,now.toISOString(),row.id,row.user_id,row.version,row.generation,
          now.toISOString(),now.toISOString(),guard.settingsVersion,payload.recipient,guard.intent,guard.facts,guard.catalogId,guard.catalogId,guard.approvedRevision),
      db.prepare(`UPDATE stage_reminders SET state='captured',version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=? AND generation=?
        AND EXISTS(SELECT 1 FROM reminder_outbox WHERE id=?)`).bind(now.toISOString(),row.id,row.user_id,row.version,row.generation,outboxId),
    ]);
    if(results[0]!.meta.changes===1)captured++;
    else if(!await db.prepare("SELECT id FROM reminder_outbox WHERE id=?").bind(outboxId).first()){
      staleSkipped++;await reconcileUserReminders(db,row.user_id,now,true);
    }
  }
  return {transport:"local-capture" as const,accounts:users.length,candidates:candidates.length,captured,staleSkipped};
}
