import { reminderDate } from "../src/private/reminder-copy.ts";
import { dateControls } from "../src/private/stage-form.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1, migrate } from "../src/local-d1.ts";
import { addExternal, privateEntries, updateProgress, changeExternalStage, saveCatalog } from "../src/private/entries.ts";
import { getEmailSettings, setVerifiedReminderAddress, setReminderPreferences, reconcileUserReminders, runReminderJob, reminderMessages, reminderTiming } from "../src/private/reminders.ts";
import { authConfig } from "../src/private/auth-config.ts";
import { newSession } from "../src/private/session.ts";
import { requestEmailCode, capturedCode, consumeEmailCode, verifyEmailCode } from "../src/private/email-codes.ts";
import { importIntoD1, inspectEdition, decideRevision, withdrawEdition } from "../src/catalog-write.ts";
import { manualSource } from "../src/sources.ts";
import { publicCatalog } from "../src/catalog-read.ts";
import { privateRoutes } from "../src/web/private-routes.ts";

const clock=new Date("2026-11-18T12:00:00Z"),due=new Date("2026-11-30T08:00:00Z");
const stage={name:"Regional qualifier",eventStart:"2026-12-01T09:00:00+01:00",eventEnd:"2026-12-01T17:00:00+01:00",timeZone:"Africa/Casablanca",format:"in-person",entry:"direct",requiresStage:null,fixedAttendance:true};
async function setup(t:TestContext){
  const folder=await mkdtemp(join(tmpdir(),"ouahad-reminders-")),runtime=await openLocalD1(join(folder,"d1"));await migrate(runtime.db);
  t.after(async()=>{await runtime.close();await rm(folder,{recursive:true,force:true});});
  for(const user of ["usr_a","usr_b"])await runtime.db.prepare("INSERT INTO private_users VALUES (?,?,'provider')").bind(user,user+"@example.org").run();
  const entry=await addExternal(runtime.db,"usr_a",{title:"Robotics — PRIVATE TEST",domain:"Robotics",eventUrl:null,stage},clock);
  const key=(await privateEntries(runtime.db,"usr_a",clock,entry))[0]!.stages[0]!.key;
  await updateProgress(runtime.db,"usr_a",entry,key,"decision","accepted",clock);
  const enable=async()=>{await setVerifiedReminderAddress(runtime.db,"usr_a","recipient@example.org",clock);assert.equal(await setReminderPreferences(runtime.db,"usr_a",true,"en",true,clock),true);};
  return {db:runtime.db,folder,entry,key,enable};
}

test("accepted stages require explicit verified consent; local captures are owned and idempotent across overlapping runs",async(t)=>{
  const {db,entry,key,enable}=await setup(t);
  assert.equal((await getEmailSettings(db,"usr_a",clock)).reminders_enabled,0);
  assert.equal(await setReminderPreferences(db,"usr_a",true,"en",true,clock),false,"email-looking Google name is not proof");
  assert.equal((await reconcileUserReminders(db,"usr_a",clock,true)).rows[0]!.reason,"email");
  await enable();
  const planned=(await reconcileUserReminders(db,"usr_a",clock,true)).rows[0]!;
  assert.equal(planned.due_at,due.toISOString());assert.equal(planned.state,"pending");
  assert.equal((await runReminderJob(db,{now:clock,capture:true})).captured,0);
  const runs=await Promise.all([runReminderJob(db,{now:due,capture:true}),runReminderJob(db,{now:due,capture:true})]);
  assert.equal(runs.reduce((total,run)=>total+run.captured,0),1);
  assert.equal((await runReminderJob(db,{now:due,capture:true})).captured,0);
  const [message]=await reminderMessages(db,"usr_a");assert.ok(message);assert.ok(message.body.includes(reminderDate(stage.eventStart!,"en")));assert.match(message.body,/Local capture only/);
  assert.deepEqual(await reminderMessages(db,"usr_b"),[]);assert.deepEqual(await reminderMessages(db,"usr_b",message.id),[]);
  assert.deepEqual(await publicCatalog(db,"all",{now:clock}),[]);
  // An already captured reminder is history, not another queued delivery after opt-in again.
  await setReminderPreferences(db,"usr_a",false,"en",true,due);await runReminderJob(db,{now:due,capture:true});
  await setReminderPreferences(db,"usr_a",true,"en",true,due);assert.equal((await runReminderJob(db,{now:due,capture:true})).captured,0);
  // A later changed schedule produces one explicit correction, never a duplicate initial reminder.
  await changeExternalStage(db,"usr_a",entry,{...stage,eventStart:"2026-12-03T09:00:00+01:00",eventEnd:"2026-12-03T17:00:00+01:00"},key);
  assert.equal((await runReminderJob(db,{now:due,capture:true})).captured,1);
  assert.equal((await runReminderJob(db,{now:due,capture:true})).captured,0);
  assert.equal((await reminderMessages(db,"usr_a")).filter((message)=>message.kind==="schedule-change").length,1);
  await assert.rejects(runReminderJob(db,{now:due}),/local reminder capture/);
  await assert.rejects(runReminderJob(db,{now:due,capture:true,origin:"https://example.org"}),/Local reminder origin/);
});

test("pending schedules are replaced and decline, opt-out, attendance and late windows cancel captures",async(t)=>{
  const {db,entry,key,enable}=await setup(t);await enable();
  const first=(await reconcileUserReminders(db,"usr_a",clock,true)).rows[0]!;
  await changeExternalStage(db,"usr_a",entry,{...stage,eventStart:"2026-12-02T09:00:00+01:00",eventEnd:"2026-12-02T17:00:00+01:00"},key);
  assert.equal((await runReminderJob(db,{now:due,capture:true})).captured,0,"stale due time does not deliver");
  let row=(await reconcileUserReminders(db,"usr_a",due,true)).rows[0]!;
  assert.equal(row.id,first.id);assert.equal(row.generation,2);assert.equal(row.due_at,"2026-12-01T08:00:00.000Z");
  await updateProgress(db,"usr_a",entry,key,"intent","declined",clock);
  assert.equal((await reconcileUserReminders(db,"usr_a",due,true)).rows[0]!.reason,"declined");
  assert.equal((await runReminderJob(db,{now:new Date(row.due_at!),capture:true})).captured,0);
  await updateProgress(db,"usr_a",entry,key,"intent","going",clock);
  await setReminderPreferences(db,"usr_a",false,"en",true,clock);
  assert.equal((await reconcileUserReminders(db,"usr_a",due,true)).rows[0]!.reason,"opt-out");
  await setReminderPreferences(db,"usr_a",true,"en",true,clock);
  await updateProgress(db,"usr_a",entry,key,"attended","1",clock);
  assert.equal((await reconcileUserReminders(db,"usr_a",due,true)).rows[0]!.reason,"attended");
  await updateProgress(db,"usr_a",entry,key,"attended","0",clock);
  row=(await reconcileUserReminders(db,"usr_a",new Date("2026-12-02T08:00:00Z"),true)).rows[0]!;
  assert.equal(row.reason,"past");assert.deepEqual(await reminderMessages(db,"usr_a"),[]);
});

test("date-only policy respects the source civil day without inventing an event time; unknown dates wait",async(t)=>{
  const {db,entry,key,enable}=await setup(t);await enable();
  assert.deepEqual(reminderTiming("2026-12-01","Asia/Tokyo"),{due:"2026-11-30T00:00:00.000Z",expires:"2026-11-30T15:00:00.000Z"});
  assert.deepEqual(dateControls(reminderTiming("2026-12-01",null)!.due,"Africa/Casablanca"),{date:"2026-11-30",time:"09:00:00"});
  await changeExternalStage(db,"usr_a",entry,{...stage,eventStart:"2026-12-01",eventEnd:"2026-12-01",timeZone:"Asia/Tokyo"},key);
  assert.equal((await runReminderJob(db,{now:new Date("2026-11-30T00:00:00Z"),capture:true})).captured,1);
  const message=(await reminderMessages(db,"usr_a"))[0]!;
  assert.match(message.body,/Start time: unknown/);assert.doesNotMatch(message.body,/1 Dec 2026,? 09:00/);
  assert.equal((await privateEntries(db,"usr_a",clock))[0]!.stages[0]!.eventStart,"2026-12-01");
  await changeExternalStage(db,"usr_a",entry,{...stage,eventStart:null,eventEnd:null},key);
  assert.equal((await reconcileUserReminders(db,"usr_a",clock,true)).rows[0]!.reason,"dates");
  assert.equal((await runReminderJob(db,{now:due,capture:true})).captured,0);
});

test("catalog reminders follow approvals only, and final D1 guards reject concurrent withdrawals and preference/schedule changes",async(t)=>{
  const {db,folder,entry,key,enable}=await setup(t);await enable();
  // First exercise an edit/opt-out that happens after the last application-level recheck.
  assert.equal((await runReminderJob(db,{now:due,capture:true,beforeCapture:async()=>{
    await setReminderPreferences(db,"usr_a",false,"en",true,due);
  }})).staleSkipped,1);
  assert.deepEqual(await reminderMessages(db,"usr_a"),[]);
  await setReminderPreferences(db,"usr_a",true,"en",true,due);
  assert.equal((await runReminderJob(db,{now:due,capture:true,beforeCapture:async()=>{
    await changeExternalStage(db,"usr_a",entry,{...stage,eventStart:"2026-12-05T09:00:00+01:00",eventEnd:"2026-12-05T17:00:00+01:00"},key);
  }})).staleSkipped,1);
  const file=join(folder,"synthetic.json"),id="reminder-test:approved";
  const sample={source:"reminder-test",externalId:"approved",title:"Approved schedule TEST",category:"morocco",countryCode:"MA",format:"in-person",eventUrl:"https://example.org",review:{url:"https://example.org",checkedAt:clock.toISOString()},stages:[{key:"main",name:"Main stage",entry:"direct",evidenceUrl:"https://example.org",eventStart:stage.eventStart,eventEnd:stage.eventEnd}]};
  const ingest=async()=>{await writeFile(file,JSON.stringify([sample]));await importIntoD1(db,[manualSource(file)],{now:clock});};
  const approve=async()=>{const row=await inspectEdition(db,id);await decideRevision(db,"publish",id,row.pendingId!,null,clock);};
  await ingest();await approve();const saved=(await saveCatalog(db,"usr_a",id,clock))!;await updateProgress(db,"usr_a",saved,"main","decision","accepted",clock);
  const original=(await reconcileUserReminders(db,"usr_a",clock,true)).rows.find((row)=>row.entry_id===saved)!;
  sample.stages[0]!.eventStart="2026-12-04T09:00:00+01:00";sample.stages[0]!.eventEnd="2026-12-04T17:00:00+01:00";await ingest();
  assert.equal((await reconcileUserReminders(db,"usr_a",clock,true)).rows.find((row)=>row.entry_id===saved)!.schedule_hash,original.schedule_hash);
  await approve();
  assert.equal((await runReminderJob(db,{now:due,capture:true})).captured,0);
  const updated=(await reconcileUserReminders(db,"usr_a",clock,true)).rows.find((row)=>row.entry_id===saved)!;assert.equal(updated.generation,2);
  assert.equal((await runReminderJob(db,{now:new Date(updated.due_at!),capture:true,beforeCapture:async(row)=>{
    if(row.entry_id===saved)await withdrawEdition(db,id,"Incorrect schedule",clock);
  }})).staleSkipped,1);
  assert.equal((await reconcileUserReminders(db,"usr_a",clock,true)).rows.find((row)=>row.entry_id===saved)!.reason,"unavailable");
  assert.deepEqual(await reminderMessages(db,"usr_a"),[]);
});

test("delivery verification is bound to account, session and purpose; it cannot sign in or merge matching identities",async(t)=>{
  const {db,entry}=await setup(t);
  const config=authConfig({AUTH_MODE:"google",AUTH_ORIGIN:"http://127.0.0.1:4177",GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test",EMAIL_SIGNIN_MODE:"capture"},true);
  if(config.mode!=="google")throw new Error();
  const session=(await newSession(db,"usr_a",clock,null,config.policy)).session,other=(await newSession(db,"usr_b",clock,null,config.policy)).session;
  await db.prepare("INSERT INTO email_identities VALUES ('recipient@example.org','usr_b',?)").bind(clock.toISOString()).run();
  const requested=await requestEmailCode(db,config,session,"recipient@example.org","/my/email-settings",clock,"reminder-address");assert.equal(requested.status,"created");if(requested.status!=="created")throw new Error();
  const message=(await capturedCode(db,session,requested.id,clock,"reminder-address"))!;
  assert.equal(await capturedCode(db,other,requested.id,clock,"reminder-address"),null);
  assert.equal(await capturedCode(db,session,requested.id,clock),null);
  assert.equal(await verifyEmailCode(db,config,session,requested.id,message.code,clock),null);
  const verified=await consumeEmailCode(db,config,session,requested.id,message.code,clock,"reminder-address");assert.ok(verified);
  await setVerifiedReminderAddress(db,session.user_id!,verified.email,clock);
  assert.equal(await consumeEmailCode(db,config,session,requested.id,message.code,clock,"reminder-address"),null);
  assert.equal((await getEmailSettings(db,"usr_a",clock)).reminders_enabled,0);
  assert.equal((await privateEntries(db,"usr_a",clock))[0]!.id,entry);
  assert.equal(await db.prepare("SELECT user_id FROM email_identities WHERE email='recipient@example.org'").first<string>("user_id"),"usr_b");
  assert.equal((await getEmailSettings(db,"usr_b",clock)).delivery_email,"recipient@example.org","only this email identity's own account can seed its setting");
});

test("production settings fail closed for captured verification and consent",async(t)=>{
  const {db}=await setup(t);
  const config=authConfig({AUTH_MODE:"google",AUTH_ORIGIN:"https://hackathons.example.org",GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test",EMAIL_SIGNIN_MODE:"capture"},false);
  if(config.mode!=="google")throw new Error();
  assert.equal(Boolean(config.emailCapture),false);
  const created=await newSession(db,"usr_a",clock,null,config.policy),cookie=created.setCookie.split(";")[0]!;
  const routes=privateRoutes(db,()=>clock,()=>config);
  const settings=await routes(new Request(config.origin+"/my/email-settings",{headers:{Cookie:cookie}}));
  assert.equal(settings?.status,200);assert.match(await settings!.text(),/Real delivery is not configured/);
  const post=(path:string,values:Record<string,string>)=>routes(new Request(config.origin+path,{method:"POST",headers:{Origin:config.origin,Cookie:cookie},body:new URLSearchParams({csrf:created.session.csrf,...values})}));
  assert.equal((await post("/my/email-settings/address",{email:"recipient@example.org"}))?.status,404);
  assert.equal((await post("/my/email-settings",{enabled:"1",language:"en"}))?.status,400);
  assert.equal((await getEmailSettings(db,"usr_a",clock)).reminders_enabled,0);
});
