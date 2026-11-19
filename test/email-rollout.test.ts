import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, Response as RuntimeResponse, type Request as RuntimeRequest, type MiniflareOptions } from "miniflare";
import { migrate } from "../src/local-d1.ts";
import { newSession } from "../src/private/session.ts";
import { authConfig } from "../src/private/auth-config.ts";
import { accountEmailConfig } from "../src/email/config.ts";
import { addExternal, privateEntries, updateProgress } from "../src/private/entries.ts";
import { reminderCron } from "../src/reminder-schedule.ts";
import { publicCatalog } from "../src/catalog-read.ts";

const origin="https://hackathons.ouahad.space";
const env={AUTH_MODE:"google",AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret",
  EMAIL_DELIVERY_MODE:"resend",EMAIL_SIGNIN_MODE:"disabled",EMAIL_ADDRESS_MODE:"owner",EMAIL_REMINDER_MODE:"owner",
  EMAIL_PUBLIC_ENABLED:"false",EMAIL_MAILBOX_TEST_VERIFIED:"false",EMAIL_FROM:"Ouahad Hackathons <no-reply@notify.ouahad.space>",
  RESEND_API_KEY:"test-only",EMAIL_ENCRYPTION_KEY:Buffer.alloc(32,9).toString("base64url"),
  EMAIL_OWNER_ADDRESSES:"owner@example.org",EMAIL_OWNER_USER_IDS:"usr_rollout_owner"};

test("Google-only account email rollout is independent of email login and fails closed before mailbox checks",()=>{
  const auth=authConfig(env,false);assert.equal(auth.mode,"google");if(auth.mode!=="google")throw new Error();
  assert.equal(auth.emailLive,undefined);assert.equal(auth.addressDelivery?.ownerOnly,true);
  assert.equal(accountEmailConfig({...env,EMAIL_OWNER_USER_IDS:""},"address"),null);
  assert.equal(accountEmailConfig({...env,EMAIL_ADDRESS_MODE:"public"},"address"),null);
  assert.equal(accountEmailConfig({...env,EMAIL_REMINDER_MODE:"public",EMAIL_PUBLIC_ENABLED:"true"},"reminder"),null);
  assert.equal(accountEmailConfig({...env,EMAIL_ADDRESS_MODE:"public",EMAIL_PUBLIC_ENABLED:"true",EMAIL_MAILBOX_TEST_VERIFIED:"true"},"address")?.ownerOnly,false);
  assert.equal(authConfig({...env,RESEND_API_KEY:""},false).mode,"google");
});

test("production Worker: owner address code, opt-in, separate reminder Cron, no login/outbox leak or duplicates",{timeout:90_000},async(t)=>{
  const bundle=await build({entryPoints:["src/sync-worker.ts"],bundle:true,write:false,format:"esm",platform:"neutral",mainFields:["module","main"],conditions:["workerd","worker","browser"],external:["node:crypto"]});
  let calls=0,code="";const subjects:string[]=[];
  const options:MiniflareOptions={host:"127.0.0.1",port:0,modules:true,script:bundle.outputFiles[0]!.text,compatibilityDate:"2026-11-17",compatibilityFlags:["nodejs_compat"],bindings:env,d1Databases:{DB:"rollout-test"},d1Persist:false,
    outboundService:async(request:RuntimeRequest)=>{assert.equal(request.url,"https://api.resend.com/emails");const mail=JSON.parse(await request.text());assert.deepEqual(mail.to,[calls<2?"owner@example.org":"public-google@example.org"]);calls++;subjects.push(mail.subject);const match=/^(\d{6})\n/.exec(mail.text);if(match)code=match[1]!;return RuntimeResponse.json({id:"provider-test-"+calls});}};
  const runtime=new Miniflare(options);
  t.after(()=>runtime.dispose());let db=await runtime.getD1Database("DB");await migrate(db);
  await db.prepare("INSERT INTO private_users VALUES('usr_rollout_owner','Owner','provider'),('usr_rollout_other','Other','provider'),('usr_email_only','Email identity','provider')").run();
  await db.prepare("INSERT INTO provider_identities VALUES('https://accounts.google.com','owner','usr_rollout_owner',?),('https://accounts.google.com','other','usr_rollout_other',?)").bind(new Date().toISOString(),new Date().toISOString()).run();
  const auth=authConfig(env,false);if(auth.mode!=="google")throw new Error();
  const owner=await newSession(db,"usr_rollout_owner",new Date(),null,auth.policy),other=await newSession(db,"usr_rollout_other",new Date(),null,auth.policy);
  const send=async(path:string,account=owner,body?:Record<string,string>)=>runtime.dispatchFetch(origin+path,{method:body?"POST":"GET",redirect:"manual",headers:{Cookie:account.setCookie,Origin:origin,...(body?{"Content-Type":"application/x-www-form-urlencoded"}:{})},...(body?{body:new URLSearchParams({csrf:account.session.csrf,...body}).toString()}:{})});
  const signin=await send("/sign-in"),html=await signin.text();assert.match(html,/Continue with Google/);assert.doesNotMatch(html,/href="\/auth\/email/);
  assert.equal((await send("/auth/email")).status,404);
  assert.equal((await send("/auth/email/start",owner,{email:"owner@example.org"})).status,404);
  assert.equal((await send("/my/email-settings/address",other,{email:"owner@example.org"})).status,404);
  assert.equal((await send("/my/email-settings/address",owner,{email:"someone@example.org"})).status,403);
  const requested=await send("/my/email-settings/address",owner,{email:"owner@example.org"});assert.equal(requested.status,303);assert.equal(calls,1);assert.ok(code);
  const challenge=new URL(requested.headers.get("location")!,origin).searchParams.get("challenge")!;
  const form=await send(requested.headers.get("location")!);assert.doesNotMatch(await form.text(),/Local capture only|local test outbox/i);
  assert.equal((await send("/my/email-settings/code-outbox?challenge="+challenge)).status,404);
  assert.equal((await send("/my/email-settings/verify",other,{challenge,code})).status,404);
  assert.equal((await send("/my/email-settings/verify",owner,{challenge,code})).status,303);
  assert.equal((await send("/my/email-settings/verify",owner,{challenge,code})).status,400);
  const settings=await db.prepare("SELECT reminders_enabled,verification_kind FROM email_reminder_settings WHERE user_id='usr_rollout_owner'").first();assert.deepEqual(settings,{reminders_enabled:0,verification_kind:"mailbox-code"});
  const now=Date.now(),id=await addExternal(db,"usr_rollout_owner",{title:"Private email rollout fixture",domain:"data science",eventUrl:null,stage:{name:"Accepted stage",eventStart:new Date(now+23*3600_000).toISOString(),eventEnd:new Date(now+25*3600_000).toISOString(),timeZone:"Africa/Casablanca",format:"online",entry:"direct",requiresStage:null,fixedAttendance:true}});
  const entry=(await privateEntries(db,"usr_rollout_owner",new Date(),id))[0]!;
  await updateProgress(db,"usr_rollout_owner",id,entry.stages[0]!.key,"decision","accepted");
  const worker=await runtime.getWorker();await worker.scheduled({cron:reminderCron,scheduledTime:new Date()});assert.equal(calls,1,"off until explicit opt-in");
  assert.equal((await send("/my/email-settings",owner,{enabled:"1",language:"en"})).status,303);
  const result=await worker.scheduled({cron:reminderCron,scheduledTime:new Date()});assert.equal(result.outcome,"ok");assert.equal(calls,2);assert.match(subjects[0]!,/delivery address/);assert.ok(!subjects[1]!.includes("sign-in code"));
  await worker.scheduled({cron:reminderCron,scheduledTime:new Date()});assert.equal(calls,2);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM local_email_outbox").first())?.n,0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM reminder_outbox").first())?.n,0);
  assert.deepEqual(await publicCatalog(db,"all"),[]);
  assert.equal((await send("/my/notifications",other)).status,404);
  assert.equal((await send("/my/notifications")).status,200);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sync_runs").first())?.n,0,"reminder Cron never starts discovery");
  // Promotion only opens the Google-account delivery path; login and local outboxes remain closed.
  await runtime.setOptions({...options,bindings:{...env,EMAIL_ADDRESS_MODE:"public",EMAIL_REMINDER_MODE:"public",EMAIL_PUBLIC_ENABLED:"true",EMAIL_MAILBOX_TEST_VERIFIED:"true"}});
  db=await runtime.getD1Database("DB");
  await new Promise(resolve=>setTimeout(resolve,1100)); // Respect the transport's one-second pacing.
  const publicRequest=await send("/my/email-settings/address",other,{email:"public-google@example.org"});
  assert.equal(publicRequest.status,303);assert.equal(calls,3);
  const publicChallenge=new URL(publicRequest.headers.get("location")!,origin).searchParams.get("challenge")!;
  assert.equal((await send("/my/email-settings/verify",owner,{challenge:publicChallenge,code})).status,400);
  assert.equal((await send("/my/email-settings/verify",other,{challenge:publicChallenge,code})).status,303);
  const otherSettings=await db.prepare("SELECT verification_kind,reminders_enabled FROM email_reminder_settings WHERE user_id='usr_rollout_other'").first();
  assert.deepEqual(otherSettings,{verification_kind:"mailbox-code",reminders_enabled:0});
  assert.equal((await db.prepare("SELECT count(*) AS n FROM live_email_identities").first())?.n,0);
  assert.equal((await send("/auth/email",other)).status,404);
  assert.equal((await send("/my/entries/"+id,other)).status,404);
  const emailOnly=await newSession(db,"usr_email_only",new Date(),null,auth.policy);
  assert.equal((await send("/my/email-settings/address",emailOnly,{email:"owner@example.org"})).status,404);
  const settingsPage=await send("/my/email-settings",other);const settingsHtml=await settingsPage.text();assert.ok(!/local.*outbox|captured.*test/i.test(settingsHtml),"Production must not show local test outboxes");

});
