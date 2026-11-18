import { newSession } from "../src/private/session.ts";
import { authConfig } from "../src/private/auth-config.ts";
import { deliveryText } from "../src/email/copy.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { Miniflare,Response as RuntimeResponse,Request as RuntimeRequest } from "miniflare";
import { migrate } from "../src/local-d1.ts";
import { addExternal,privateEntries,updateProgress } from "../src/private/entries.ts";

test("production Worker in local workerd: mocked Resend codes, mailbox verification, reminder delivery, private states and fail-closed Google fallback",{timeout:90_000},async(t)=>{
 const origin="https://hackathons.ouahad.space",codes:string[]=[];let calls=0;
 // The test-only service invokes the prepared runner without adding a public trigger to the real Worker.
 const runner=await build({stdin:{contents:`import {runWorkerEmailJob} from './src/sync-worker.ts';export default {fetch(request,env){return runWorkerEmailJob(env,new Date(Date.now()+Number(new URL(request.url).searchParams.get('advance')??2000))).then(value=>Response.json(value));}}`,resolveDir:process.cwd()},bundle:true,write:false,format:"esm",platform:"neutral",mainFields:["module","main"],conditions:["workerd","worker","browser"],external:["node:crypto"]});
 const bundle=await build({entryPoints:[fileURLToPath(new URL("../src/sync-worker.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"neutral",mainFields:["module","main"],conditions:["workerd","worker","browser"],external:["node:crypto"]});
 const bindings={AUTH_MODE:"google",AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:"mock-google-client",GOOGLE_CLIENT_SECRET:"mock-google-secret",EMAIL_DELIVERY_MODE:"resend",EMAIL_SIGNIN_MODE:"live",EMAIL_PUBLIC_ENABLED:"true",EMAIL_MAILBOX_TEST_VERIFIED:"true",EMAIL_FROM:"Ouahad Hackathons <no-reply@notify.ouahad.space>",RESEND_API_KEY:"mock-key-never-live",EMAIL_ENCRYPTION_KEY:Buffer.alloc(32,5).toString("base64url")};
 const outbound=async(request:RuntimeRequest)=>{assert.equal(request.url,"https://api.resend.com/emails","any unexpected network target fails the test");calls++;const body=JSON.parse(await request.text());const code=/^(\d{6})\n/.exec(body.text)?.[1];if(code)codes.push(code);assert.ok(request.headers.get("Idempotency-Key"));return RuntimeResponse.json({id:"mock-resend-"+calls});};
 const runtime=new Miniflare({workers:[{name:"catalog",modules:true,script:bundle.outputFiles[0]!.text,compatibilityDate:"2026-11-17",compatibilityFlags:["nodejs_compat"],bindings,d1Databases:{DB:"email-worker-test"},outboundService:outbound},{name:"runner",modules:true,script:runner.outputFiles[0]!.text,compatibilityDate:"2026-11-17",compatibilityFlags:["nodejs_compat"],bindings,d1Databases:{DB:"email-worker-test"},outboundService:outbound}],d1Persist:false});
 t.after(()=>runtime.dispose());const db=await runtime.getD1Database("DB","catalog");await migrate(db);
 const send=async(path:string,cookie="",body?:Record<string,string>)=>runtime.dispatchFetch(origin+path,{method:body?"POST":"GET",redirect:"manual",headers:{Cookie:cookie,Origin:origin,...(body?{"Content-Type":"application/x-www-form-urlencoded"}:{})},...(body?{body:new URLSearchParams(body).toString()}:{})});
 const start=await send("/sign-in?lang=ar"),pre=start.headers.getSetCookie()[0]!.split(";")[0]!;const csrf=/name="csrf" value="([a-f0-9]+)"/.exec(await start.text())![1]!;
 const response=await send("/auth/email/start?lang=ar",pre,{csrf,email:"owner@example.org",next:"/my?lang=ar"});assert.equal(response.status,303);assert.equal(calls,1,JSON.stringify((await db.prepare("SELECT state,error_code FROM email_deliveries").all()).results));
 const location=response.headers.get("location")!,challenge=new URL(location,origin).searchParams.get("challenge")!;
 const codePage=await send(location,pre);assert.equal(codePage.status,200);const html=await codePage.text();assert.match(html,/قبله مزود البريد/);assert.doesNotMatch(html,/code-outbox|auth\/email\/outbox/);assert.ok(!html.includes(codes[0]!));
 assert.equal((await send("/auth/email/outbox?challenge="+challenge,pre)).status,404);
 const verified=await send("/auth/email/verify?lang=ar",pre,{csrf,challenge,code:codes[0]!});assert.equal(verified.status,303);assert.equal(verified.headers.get("location"),"/my?lang=ar");
 const cookie=verified.headers.getSetCookie()[0]!.split(";")[0]!;assert.match(cookie,/__Host-ouahad_session=/);const dashboard=await send("/my?lang=ar",cookie);assert.equal(dashboard.status,200);const ownerCsrf=/name="csrf" value="([a-f0-9]+)"/.exec(await dashboard.text())![1]!;
 const user=await db.prepare("SELECT user_id FROM live_email_identities WHERE email='owner@example.org'").first<string>("user_id");assert.ok(user);
 const stage={name:"Owner-only private stage",eventStart:new Date(Date.now()+23*3600_000).toISOString(),eventEnd:new Date(Date.now()+25*3600_000).toISOString(),timeZone:"Africa/Casablanca",format:"in-person",entry:"direct",requiresStage:null,fixedAttendance:true};
 const entry=await addExternal(db,user,{title:"Private Worker email fixture",domain:"Robotics",eventUrl:null,stage},new Date()),key=(await privateEntries(db,user))[0]!.stages[0]!.key;await updateProgress(db,user,entry,key,"decision","accepted",new Date());
 assert.equal((await send("/my/email-settings",cookie,{csrf:ownerCsrf,enabled:"1",language:"ar"})).status,303);
 const worker=await runtime.getWorker("runner");await worker.fetch(origin+"/test-only-runner");assert.equal(calls,2);await worker.fetch(origin+"/test-only-runner");assert.equal(calls,2,"repeated job cannot duplicate acceptance");
 for(const lang of ["en","fr","ar"] as const){const agenda=await send("/my?lang="+lang,cookie);assert.match(await agenda.text(),new RegExp(deliveryText[lang].accepted));}
 await db.prepare("INSERT INTO private_users VALUES ('usr_other_email','Other','provider')").run();const auth=authConfig(bindings,false);if(auth.mode!=="google")throw new Error();
 const other=(await newSession(db,"usr_other_email",new Date(),null,auth.policy)).setCookie.split(";")[0]!;
 const deliveryId=await db.prepare("SELECT id FROM email_deliveries WHERE kind='reminder'").first<string>("id");
 assert.equal((await send("/my/notifications/"+deliveryId,other)).status,404);assert.equal((await send("/my/entries/"+entry,other)).status,404);
 const requestedAddress=await send("/my/email-settings/address",cookie,{csrf:ownerCsrf,email:"verify-owner@example.org"});assert.equal(requestedAddress.status,303);
 const addressChallenge=new URL(requestedAddress.headers.get("location")!,origin).searchParams.get("challenge")!;
 await worker.fetch(origin+"/test-only-runner?advance=5000");assert.equal(calls,3);
 assert.equal((await send("/my/email-settings/code-outbox?challenge="+addressChallenge,cookie)).status,404);
 assert.equal((await send("/my/email-settings/verify",cookie,{csrf:ownerCsrf,challenge:addressChallenge,code:codes[1]!})).status,303);
 const settings=await db.prepare("SELECT reminders_enabled,delivery_email,verification_kind FROM email_reminder_settings WHERE user_id=?").bind(user).first<{reminders_enabled:number;delivery_email:string;verification_kind:string}>();
 assert.equal(settings!.reminders_enabled,0);assert.equal(settings!.delivery_email,"verify-owner@example.org");assert.equal(settings!.verification_kind,"mailbox-code");
 const statuses=await send("/my/notifications?lang=ar",cookie);assert.equal(statuses.status,200);assert.match(await statuses.text(),/قبله مزود البريد/);
 assert.doesNotMatch(await(await send("/")).text(),/Private Worker email fixture/);
 assert.equal((await db.prepare("SELECT * FROM local_email_outbox").all()).results.length,0);
 // A missing API key never turns off Google or exposes live email sign-in.
 const unavailable=new Miniflare({modules:true,script:bundle.outputFiles[0]!.text,compatibilityDate:"2026-11-17",compatibilityFlags:["nodejs_compat"],bindings:{...bindings,RESEND_API_KEY:""},d1Databases:{DB:"unavailable-test"},d1Persist:false});t.after(()=>unavailable.dispose());await migrate(await unavailable.getD1Database("DB"));
 const login=await unavailable.dispatchFetch(origin+"/sign-in"),loginHtml=await login.text();assert.equal(login.status,200);assert.match(loginHtml,/Continue with Google/);assert.doesNotMatch(loginHtml,/href="\/auth\/email/);assert.equal((await unavailable.dispatchFetch(origin+"/auth/email")).status,404);
});
