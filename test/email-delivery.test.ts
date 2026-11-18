import assert from "node:assert/strict";
import { test,type TestContext } from "node:test";
import { mkdtemp,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalD1,migrate } from "../src/local-d1.ts";
import { authConfig } from "../src/private/auth-config.ts";
import { newSession } from "../src/private/session.ts";
import { requestEmailCode,verifyEmailCode,consumeEmailCode,capturedCode } from "../src/private/email-codes.ts";
import { resendConfig } from "../src/email/config.ts";
import { enqueueEmail,attemptDelivery,deliveryStatus,ownerDeliveries,codeDeliveryAvailable } from "../src/email/queue.ts";
import { sendResend } from "../src/email/resend.ts";
import { dispatchTransactionalEmail,planLiveReminders } from "../src/email/service.ts";
import { validateSmoke } from "../src/email-cli.ts";
import { addExternal,privateEntries,updateProgress,saveCatalog } from "../src/private/entries.ts";
import { getEmailSettings,setReminderPreferences,setVerifiedReminderAddress,reconcileUserReminders } from "../src/private/reminders.ts";
import { importIntoD1,inspectEdition,decideRevision,withdrawEdition } from "../src/catalog-write.ts";
import { manualSource } from "../src/sources.ts";

const now=new Date("2026-11-30T08:00:00Z"),origin="https://hackathons.ouahad.space";
export const emailEnv={EMAIL_DELIVERY_MODE:"resend",EMAIL_SIGNIN_MODE:"live",EMAIL_PUBLIC_ENABLED:"true",EMAIL_MAILBOX_TEST_VERIFIED:"true",EMAIL_FROM:"Ouahad Hackathons <no-reply@notify.ouahad.space>",EMAIL_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64url"),RESEND_API_KEY:"mock-secret-not-real",EMAIL_OWNER_ADDRESSES:"owner@example.org"};
const config=resendConfig(emailEnv)!;
function provider(){let calls=0;const keys:string[]=[],bodies:string[]=[];const fetcher:typeof fetch=async(url,init)=>{assert.equal(url,"https://api.resend.com/emails");calls++;keys.push(new Headers(init!.headers).get("Idempotency-Key")!);bodies.push(String(init!.body));return Response.json({id:"provider-"+calls});};return {fetcher,keys,bodies,get calls(){return calls;}};}
async function setup(t:TestContext){const folder=await mkdtemp(join(tmpdir(),"ouahad-email-live-")),runtime=await openLocalD1(join(folder,"d1"));await migrate(runtime.db);t.after(async()=>{await runtime.close();await rm(folder,{recursive:true,force:true});});return {db:runtime.db,folder};}
const after=(seconds:number)=>new Date(now.getTime()+seconds*1000);

test("live codes use encrypted retry payloads, one-use verification and separate identities; Google and captured accounts are never merged",async(t)=>{
 const {db}=await setup(t),mock=provider();
 const auth=authConfig({...emailEnv,AUTH_MODE:"google",AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test"},false);if(auth.mode!=="google"||!auth.emailLive)throw new Error();
 await db.prepare("INSERT INTO private_users VALUES ('usr_google','owner@example.org','provider')").run();await db.prepare("INSERT INTO private_users VALUES ('usr_capture','owner@example.org','provider')").run();
 await db.prepare("INSERT INTO email_identities VALUES ('owner@example.org','usr_capture',?)").bind(now.toISOString()).run();
 const anonymous=(await newSession(db,null,now,null,auth.policy)).session;
 const requested=await requestEmailCode(db,auth,anonymous,"owner@example.org","/my?lang=fr",now,"signin","fr",{fetcher:mock.fetcher});if(requested.status!=="created")throw new Error();
 assert.equal(mock.calls,1);const code=JSON.parse(mock.bodies[0]!).text.split("\n")[0];
 assert.equal((await db.prepare("SELECT * FROM local_email_outbox").all()).results.length,0);assert.equal(await capturedCode(db,anonymous,requested.id,now),null);
 const job=await db.prepare("SELECT * FROM email_deliveries WHERE challenge_id=?").bind(requested.id).first<{id:string;state:string;encrypted_payload:string|null}>();assert.equal(job!.state,"provider_accepted");assert.equal(job!.encrypted_payload,null);
 const other=(await newSession(db,null,now,null,auth.policy)).session;assert.equal(await verifyEmailCode(db,auth,other,requested.id,code,now),null);
 const verified=await verifyEmailCode(db,auth,anonymous,requested.id,code,now);assert.ok(verified);assert.equal(verified.next,"/my?lang=fr");assert.notEqual(verified.session.user_id,"usr_capture");assert.notEqual(verified.session.user_id,"usr_google");
 assert.equal(await verifyEmailCode(db,auth,anonymous,requested.id,code,now),null);
 assert.equal((await getEmailSettings(db,verified.session.user_id!,now)).verification_kind,"mailbox-code");
 const address=await requestEmailCode(db,auth,verified.session,"owner@example.org","/my/email-settings",after(61),"reminder-address","en",{fetcher:mock.fetcher});if(address.status!=="created")throw new Error();
 const addressCode=JSON.parse(mock.bodies.at(-1)!).text.split("\n")[0];
 assert.equal(await consumeEmailCode(db,auth,verified.session,address.id,addressCode,after(61),"signin"),null);
 assert.ok(await consumeEmailCode(db,auth,verified.session,address.id,addressCode,after(61),"reminder-address"));
 assert.equal(await consumeEmailCode(db,auth,verified.session,address.id,addressCode,after(61),"reminder-address"),null);
 assert.equal((await requestEmailCode(db,auth,verified.session,"owner@example.org","/my",after(62),"signin","en",{fetcher:mock.fetcher})).status,"limited");
});

test("timeout retry uses identical provider body and idempotency key; bounded and overlapping retries never claim mailbox receipt",async(t)=>{
 const {db}=await setup(t),mock=provider();
 const id=await enqueueEmail(db,config,"signin","timeout",{to:["owner@example.org"],subject:"Mock code",text:"fixture-only"},after(600),now);
 const timeout:typeof fetch=async(_url,init)=>{assert.ok(init?.signal);throw new TypeError("simulated timeout");};
 const authorize=async()=>true;
 assert.equal((await attemptDelivery(db,config,id,{now,fetcher:timeout,authorize})).state,"retry_wait");
 const encrypted=await db.prepare("SELECT encrypted_payload FROM email_deliveries WHERE id=?").bind(id).first<string>("encrypted_payload");assert.ok(encrypted&&!encrypted.includes("fixture-only"));
 const results=await Promise.all([attemptDelivery(db,config,id,{now:after(5),fetcher:mock.fetcher,authorize}),attemptDelivery(db,config,id,{now:after(5),fetcher:mock.fetcher,authorize})]);
 assert.equal(mock.calls,1);assert.ok(results.some((item)=>item.state==="provider_accepted"));
 assert.equal((await deliveryStatus(db,id))!.state,"provider_accepted");assert.equal((await attemptDelivery(db,config,id,{now:after(7),fetcher:mock.fetcher,authorize})).state,"provider_accepted");assert.equal(mock.calls,1);
 const unknown=await enqueueEmail(db,config,"signin","always-timeout",{to:["owner@example.org"],subject:"Mock",text:"fixture"},after(600),after(10));
 for(const n of [10,15,25])await attemptDelivery(db,config,unknown,{now:after(n),fetcher:timeout,authorize});
 assert.equal((await deliveryStatus(db,unknown))!.state,"unknown");assert.equal((await deliveryStatus(db,unknown))!.attempts,3);
 const keys:string[]=[],bodies:string[]=[];let count=0;
 const ambiguous:typeof fetch=async(_url,init)=>{keys.push(new Headers(init!.headers).get("Idempotency-Key")!);bodies.push(String(init!.body));if(++count===1)throw new Error("mock connection lost after provider accepted");return Response.json({id:"same-provider-message"});};
 const stable=await enqueueEmail(db,config,"signin","stable",{to:["owner@example.org"],subject:"Mock",text:"fixture"},after(600),after(30));
 await attemptDelivery(db,config,stable,{now:after(30),fetcher:ambiguous,authorize});await attemptDelivery(db,config,stable,{now:after(35),fetcher:ambiguous,authorize});assert.equal(keys[0],keys[1]);assert.equal(bodies[0],bodies[1]);
 const uncertain=await enqueueEmail(db,config,"signin","cancel-uncertain",{to:["owner@example.org"],subject:"Mock",text:"fixture"},after(600),after(40));
 await attemptDelivery(db,config,uncertain,{now:after(40),fetcher:timeout,authorize});
 assert.equal((await attemptDelivery(db,config,uncertain,{now:after(45),fetcher:mock.fetcher,authorize:async()=>false})).state,"unknown","cancelling a retry cannot prove the timed-out request was not accepted");
 const horizon=await enqueueEmail(db,config,"reminder","horizon",{to:["owner@example.org"],subject:"Mock",text:"fixture"},after(48*3600),after(50));
 await attemptDelivery(db,config,horizon,{now:after(50),fetcher:timeout,authorize});
 assert.equal((await attemptDelivery(db,config,horizon,{now:after(23*3600+50),fetcher:mock.fetcher,authorize})).state,"unknown","never cross the provider idempotency retention window");
});

test("reminders cannot consume the reserved code budget and queued codes have dispatch priority",async(t)=>{
 const {db}=await setup(t),mock=provider(),authorize=async()=>true;
 const reminder=await enqueueEmail(db,config,"reminder","priority",{to:["owner@example.org"],subject:"Reminder",text:"fixture"},after(86400),now);
 const code=await enqueueEmail(db,config,"signin","priority-code",{to:["owner@example.org"],subject:"Code",text:"fixture"},after(600),now);
 assert.equal((await attemptDelivery(db,config,reminder,{now,fetcher:mock.fetcher,authorize})).state,"deferred");assert.equal(mock.calls,0);
 await attemptDelivery(db,config,code,{now,fetcher:mock.fetcher,authorize});
 for(let i=0;i<20;i++){const id=i?await enqueueEmail(db,config,"reminder","budget-"+i,{to:["owner@example.org"],subject:"Reminder",text:"fixture"},after(86400),now):reminder;await attemptDelivery(db,config,id,{now:after(2+i*2),fetcher:mock.fetcher,authorize});}
 const extra=await enqueueEmail(db,config,"reminder","budget-over",{to:["owner@example.org"],subject:"Reminder",text:"fixture"},after(86400),now);
 assert.equal((await attemptDelivery(db,config,extra,{now:after(45),fetcher:mock.fetcher,authorize})).state,"quota_wait");assert.equal(mock.calls,21);
 const another=await enqueueEmail(db,config,"reminder-address","reserved-code",{to:["owner@example.org"],subject:"Verification",text:"fixture"},after(600),now);
 assert.equal((await attemptDelivery(db,config,another,{now:after(46),fetcher:mock.fetcher,authorize})).state,"provider_accepted");assert.equal(await codeDeliveryAvailable(db,after(46)),true);
});

test("provider quota exhaustion stops calls until reset; Retry-After, timeouts, redirects and permanent errors are bounded",async(t)=>{
 const {db}=await setup(t);let calls=0;
 const exhausted:typeof fetch=async()=>{calls++;return Response.json({name:"daily_quota_exceeded",message:"never echo provider bodies"},{status:429});};
 const id=await enqueueEmail(db,config,"signin","quota",{to:["owner@example.org"],subject:"Code",text:"fixture"},after(600),now);
 assert.equal((await attemptDelivery(db,config,id,{now,fetcher:exhausted,authorize:async()=>true})).state,"quota_wait");
 assert.equal(await codeDeliveryAvailable(db,after(5)),false);await attemptDelivery(db,config,id,{now:after(5),fetcher:exhausted,authorize:async()=>true});assert.equal(calls,1);
 await attemptDelivery(db,config,id,{now:new Date("2026-12-01T00:00:00Z"),fetcher:exhausted,authorize:async()=>true});assert.equal((await deliveryStatus(db,id))!.state,"cancelled");assert.equal(calls,1);
 const mail={from:config.from,to:["owner@example.org"],subject:"Code",text:"fixture"};
 assert.deepEqual(await sendResend(config,"retry",mail,{fetcher:async()=>Response.json({name:"rate_limit_exceeded"},{status:429,headers:{"Retry-After":"19"}})}),{state:"retry_wait",code:"rate_limit",retryAfterSeconds:19});
 assert.equal((await sendResend(config,"permanent",mail,{fetcher:async()=>Response.json({name:"validation_error",message:"secret fixture"},{status:403})})).state,"failed");
 assert.equal((await sendResend(config,"redirect",mail,{fetcher:async(_url,init)=>{assert.equal(init!.redirect,"manual");return new Response(null,{status:302,headers:{Location:"https://example.org"}});}})).state,"failed");
 const aborted:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(new Error("fixture timeout"))));
 assert.equal((await sendResend(config,"abort",mail,{fetcher:aborted,timeoutMs:5})).state,"retry_wait");
});

test("approved schedules are rechecked before network delivery; proposals, rescheduling, decline, opt-out and withdrawal keep stale mail unsent",async(t)=>{
 const {db,folder}=await setup(t),mock=provider();await db.prepare("INSERT INTO private_users VALUES ('usr_owner','Owner','provider')").run();
 await setVerifiedReminderAddress(db,"usr_owner","owner@example.org",now,"resend");await setReminderPreferences(db,"usr_owner",true,"en","resend",now);
 const file=join(folder,"synthetic.json"),edition="email-test:stage";
 const sample={source:"email-test",externalId:"stage",title:"Private test schedule",category:"morocco",countryCode:"MA",format:"in-person",eventUrl:"https://example.org",review:{url:"https://example.org",checkedAt:now.toISOString()},stages:[{key:"final",name:"National final",entry:"direct",evidenceUrl:"https://example.org",eventStart:"2026-12-01T09:00:00+01:00",eventEnd:"2026-12-01T17:00:00+01:00"}]};
 const ingest=async()=>{await writeFile(file,JSON.stringify([sample]));await importIntoD1(db,[manualSource(file)],{now});};const approve=async()=>{const review=await inspectEdition(db,edition);await decideRevision(db,"publish",edition,review.pendingId!,null,now);};
 await ingest();await approve();const entry=(await saveCatalog(db,"usr_owner",edition,now))!;await updateProgress(db,"usr_owner",entry,"final","decision","accepted",now);
 const [old]=await planLiveReminders(db,config,origin,now);assert.ok(old);
 sample.stages[0]!.eventStart="2026-12-02T09:00:00+01:00";sample.stages[0]!.eventEnd="2026-12-02T17:00:00+01:00";await ingest();
 assert.equal((await planLiveReminders(db,config,origin,now))[0],old,"a proposal cannot change the approved plan");await approve();
 assert.equal((await dispatchTransactionalEmail(db,config,old,{now,fetcher:mock.fetcher})).state,"cancelled");assert.equal(mock.calls,0);
 const due=new Date("2026-12-01T08:00:00Z"),[current]=await planLiveReminders(db,config,origin,due);assert.ok(current);
 assert.equal((await dispatchTransactionalEmail(db,config,current,{now:due,fetcher:mock.fetcher,beforeAuthorize:async()=>{await updateProgress(db,"usr_owner",entry,"final","intent","declined",now);}})).state,"cancelled");assert.equal(mock.calls,0);
 await updateProgress(db,"usr_owner",entry,"final","intent","going",now);await planLiveReminders(db,config,origin,due);
 assert.equal((await dispatchTransactionalEmail(db,config,current,{now:due,fetcher:mock.fetcher})).state,"provider_accepted");assert.equal(mock.calls,1);assert.doesNotMatch(JSON.parse(mock.bodies[0]!).text,/Local capture|test outbox/);
 const context=await reconcileUserReminders(db,"usr_owner",due,"resend");assert.equal(context.rows[0]!.state,"captured");assert.equal(context.messages.length,0);assert.equal(context.deliveries![0]!.state,"provider_accepted");assert.deepEqual(await ownerDeliveries(db,"usr_other"),[]);
 sample.stages[0]!.eventStart="2026-12-03T09:00:00+01:00";sample.stages[0]!.eventEnd="2026-12-03T17:00:00+01:00";await ingest();await approve();const [correction]=await planLiveReminders(db,config,origin,due);assert.ok(correction);assert.notEqual(correction,current);
 await setReminderPreferences(db,"usr_owner",false,"en","resend",now);assert.equal((await dispatchTransactionalEmail(db,config,correction,{now:new Date(due.getTime()+2000),fetcher:mock.fetcher})).state,"cancelled");
 await setReminderPreferences(db,"usr_owner",true,"en","resend",now);await planLiveReminders(db,config,origin,due);await withdrawEdition(db,edition,"Incorrect listing",now);
 assert.equal((await dispatchTransactionalEmail(db,config,correction,{now:new Date(due.getTime()+3000),fetcher:mock.fetcher})).state,"cancelled");assert.equal(mock.calls,1);
});

test("disabled or incomplete live config preserves Google; smoke allowlist is exact and local test proofs cannot enable live reminders",async(t)=>{
 const env={...emailEnv,AUTH_MODE:"google",AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:"test",GOOGLE_CLIENT_SECRET:"test"};
 for(const patch of [{EMAIL_DELIVERY_MODE:"disabled"},{RESEND_API_KEY:""},{EMAIL_ENCRYPTION_KEY:""},{EMAIL_MAILBOX_TEST_VERIFIED:"false"},{EMAIL_PUBLIC_ENABLED:"false"},{EMAIL_SIGNIN_MODE:"capture"}]){const auth=authConfig({...env,...patch},false);assert.equal(auth.mode,"google");if(auth.mode==="google")assert.equal(auth.emailLive,undefined);}
 assert.equal(validateSmoke(config,"OWNER@example.org"),"owner@example.org");for(const invalid of ["other@example.org","owner@example.org.evil","*@example.org","owner@example.org,other@example.org"])assert.throws(()=>validateSmoke(config,invalid));
 const {db}=await setup(t);await db.prepare("INSERT INTO private_users VALUES ('usr_local','Local','provider')").run();await setVerifiedReminderAddress(db,"usr_local","owner@example.org",now);assert.equal(await setReminderPreferences(db,"usr_local",true,"en","resend",now),false);
});
