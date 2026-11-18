import assert from "node:assert/strict";
import { test } from "node:test";
import { migrate, openLocalD1 } from "../src/local-d1.ts";
import { authConfig } from "../src/private/auth-config.ts";
import { newSession, findSession } from "../src/private/session.ts";
import { requestEmailCode, verifyEmailCode, capturedCode } from "../src/private/email-codes.ts";
import { addExternal, privateEntries, savePrivateStage, stageVersion, updateProgress } from "../src/private/entries.ts";
import { dateControls, fromDateControls } from "../src/private/stage-form.ts";
import { catalogHandler } from "../src/web/catalog-handler.ts";
import { opportunityStatus, nextStage } from "../src/web/private-page.ts";

const now=new Date("2026-11-18T10:00:00Z");
const env={AUTH_MODE:"google",AUTH_ORIGIN:"http://127.0.0.1:4199",GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret",EMAIL_SIGNIN_MODE:"capture"};
const facts={name:"Private stage",eventStart:"2026-12-10",eventEnd:"2026-12-10",timeZone:"Africa/Casablanca",format:"in-person",entry:"direct",requiresStage:null,fixedAttendance:true};
test("local email codes are short-lived, single-use, browser-bound and do not claim a matching Google identity",async(t)=>{
 const d1=await openLocalD1(false);await migrate(d1.db);t.after(d1.close);
 const config=authConfig(env,true);if(config.mode!=="google")throw new Error();
 const pre=await newSession(d1.db,null,now,null,config.policy),other=await newSession(d1.db,null,now,null,config.policy);
 await d1.db.prepare("INSERT INTO private_users VALUES ('usr_google_existing','person@yahoo.com','provider')").run();
 await d1.db.prepare("INSERT INTO provider_identities VALUES ('https://accounts.google.com','existing-google','usr_google_existing',?)").bind(now.toISOString()).run();
 const googleEntry=await addExternal(d1.db,'usr_google_existing',{title:"Existing Google user's opportunity",domain:"science",eventUrl:null,stage:facts},now);
 const pending=await requestEmailCode(d1.db,config,pre.session,"Person@Yahoo.com","/my/new?lang=fr",now);if(pending.status!=="created")throw new Error();
 assert.equal((await d1.db.prepare("SELECT count(*) AS n FROM email_identities").first())?.n,0,"verification precedes creation");
 const out=await capturedCode(d1.db,pre.session,pending.id,now);assert.match(out!.code,/^\d{6}$/);
 assert.equal(await capturedCode(d1.db,other.session,pending.id,now),null);
 assert.equal(await verifyEmailCode(d1.db,config,other.session,pending.id,out!.code,now),null);
 const results=await Promise.all([verifyEmailCode(d1.db,config,pre.session,pending.id,out!.code,now),verifyEmailCode(d1.db,config,pre.session,pending.id,out!.code,now)]);
 assert.equal(results.filter(Boolean).length,1);
 const verified=results.find(Boolean)!;assert.equal(verified.next,"/my/new?lang=fr");
 assert.notEqual(verified.session.user_id,"usr_google_existing");
 assert.deepEqual(await privateEntries(d1.db,verified.session.user_id!,now),[]);
 assert.equal((await privateEntries(d1.db,"usr_google_existing",now))[0]!.id,googleEntry);
 assert.equal(await findSession(d1.db,pre.setCookie,now,config.policy),null);
 assert.equal(await capturedCode(d1.db,pre.session,pending.id,now),null,"outbox code removed on successful rotation");
 assert.equal(await verifyEmailCode(d1.db,config,pre.session,pending.id,out!.code,now),null);
 const later=new Date(now.getTime()+61_000),returning=await newSession(d1.db,null,later,null,config.policy);
 const again=await requestEmailCode(d1.db,config,returning.session,"person@yahoo.com","/my",later);if(again.status!=="created")throw new Error();
 const secondCode=await capturedCode(d1.db,returning.session,again.id,later);
 const signed=await verifyEmailCode(d1.db,config,returning.session,again.id,secondCode!.code,later);
 assert.equal(signed!.session.user_id,verified.session.user_id,"returning email identity is stable");
 const production=authConfig({...env,AUTH_ORIGIN:"https://hackathons.ouahad.space"},false);
 assert.equal(production.mode,"google");if(production.mode!=="google")throw new Error();assert.equal(production.emailCapture,false);
 const signin=await catalogHandler(new Request('https://hackathons.ouahad.space/sign-in'),d1.db,{auth:production,now:()=>now});
 const signinHtml=await signin.text();assert.match(signinHtml,/Continue with Google/);assert.match(signinHtml,/disabled/);assert.doesNotMatch(signinHtml,/href="\/auth\/email/);
 for(const path of ["/auth/email","/auth/email/outbox?challenge="+again.id]){
  const response=await catalogHandler(new Request("https://hackathons.ouahad.space"+path),d1.db,{auth:production,now:()=>now});assert.equal(response.status,404);
 }
});

test("email expiry, attempts, resend invalidation and cooldown are enforced in D1",async(t)=>{
 const d1=await openLocalD1(false);await migrate(d1.db);t.after(d1.close);
 const config=authConfig(env,true);if(config.mode!=="google")throw new Error();
 const pre=await newSession(d1.db,null,now,null,config.policy);
 const issue=async(clock:Date)=>{const row=await requestEmailCode(d1.db,config,pre.session,"someone@outlook.com","/my",clock);if(row.status!=="created")throw new Error();return {id:row.id,code:(await capturedCode(d1.db,pre.session,row.id,clock))!.code};};
 const initial=await issue(now);
 assert.equal((await requestEmailCode(d1.db,config,pre.session,"someone@outlook.com","/my",now)).status,"limited");
 const next=await issue(new Date(now.getTime()+61_000));
 assert.equal(await verifyEmailCode(d1.db,config,pre.session,initial.id,initial.code,now),null,"resend invalidates prior code");
 for(let i=0;i<5;i++)assert.equal(await verifyEmailCode(d1.db,config,pre.session,next.id,"bad",now),null);
 assert.equal(await verifyEmailCode(d1.db,config,pre.session,next.id,next.code,now),null,"five failed attempts exhaust code");
 const third=await issue(new Date(now.getTime()+122_000));
 assert.equal(await verifyEmailCode(d1.db,config,pre.session,third.id,third.code,new Date(now.getTime()+723_000)),null,"expired code rejected");
 await assert.rejects(requestEmailCode(d1.db,config,pre.session,"not-an-email","/my",now));
});

test("date controls preserve precision and zones, including nonexistent and repeated local times",()=>{
 assert.equal(fromDateControls("2026-12-10","","",""),"2026-12-10");
 assert.equal(fromDateControls("","","",""),null);
 assert.equal(fromDateControls("2026-12-10","09:00","Africa/Casablanca",""),"2026-12-10T08:00:00.000Z");
 assert.deepEqual(dateControls("2026-12-10T08:00:00Z","Africa/Casablanca"),{date:"2026-12-10",time:"09:00:00"});
 assert.deepEqual(dateControls("2026-12-10T09:00+01:00",null),{date:"2026-12-10",time:"09:00:00"});
 assert.equal(fromDateControls("2026-12-10","09:00","","","2026-12-10T09:00+01:00"),"2026-12-10T09:00+01:00");
 assert.equal(fromDateControls("2026-12-10","09:00","Africa/Casablanca","","2026-12-10T09:00:00+01:00"),"2026-12-10T09:00:00+01:00");
 assert.throws(()=>fromDateControls("2026-03-08","02:30","America/New_York",""),/does not exist/);
 assert.throws(()=>fromDateControls("2026-11-01","01:30","America/New_York",""),/occurrence/);
 assert.equal(fromDateControls("2026-11-01","01:30","America/New_York","first"),"2026-11-01T05:30:00.000Z");
 assert.equal(fromDateControls("2026-11-01","01:30","America/New_York","second"),"2026-11-01T06:30:00.000Z");
 assert.equal(fromDateControls("2026-11-01","01:30","America/New_York","first","2026-11-01T06:30:00Z"),"2026-11-01T05:30:00.000Z");
 assert.throws(()=>fromDateControls("2026-12-10","09:00","",""),/zone/);
 assert.throws(()=>fromDateControls("","09:00","Africa/Casablanca",""),/date/);
});

test("one stage save preserves independent dimensions and refuses stale or cross-owner updates",async(t)=>{
 const d1=await openLocalD1(false);await migrate(d1.db);t.after(d1.close);await newSession(d1.db,"dev-aya",now);
 const id=await addExternal(d1.db,"dev-aya",{title:"Private science",domain:"science",eventUrl:null,stage:facts},now);
 let entry=(await privateEntries(d1.db,"dev-aya",now,id))[0]!,stage=entry.stages[0]!;
 const state={application:"submitted",decision:"accepted",intent:"going",attended:"1",result:"advanced"};
 assert.equal(await savePrivateStage(d1.db,"dev-sami",id,stage.key,stageVersion(stage),state,facts,now),"missing");
 const token=stageVersion(stage);
 assert.equal(await savePrivateStage(d1.db,"dev-aya",id,stage.key,token,state,facts,now),"saved");
 assert.equal(await savePrivateStage(d1.db,"dev-aya",id,stage.key,token,{...state,intent:"declined"},facts,now),"stale");
 entry=(await privateEntries(d1.db,"dev-aya",now,id))[0]!;stage=entry.stages[0]!;
 assert.equal(stage.eventStart,"2026-12-10");
 assert.equal(await savePrivateStage(d1.db,"dev-aya",id,stage.key,stageVersion(stage),{...state,intent:"declined"},facts,now),"saved");
 stage=(await privateEntries(d1.db,"dev-aya",now,id))[0]!.stages[0]!;
 assert.deepEqual([stage.application,stage.decision,stage.intent,stage.attended,stage.result],["submitted","accepted","declined",1,"advanced"]);
 assert.equal(opportunityStatus({...entry,stages:[stage]}),"participated");
 await updateProgress(d1.db,"dev-aya",id,stage.key,"attended","0",now);
 assert.equal(nextStage(await privateEntries(d1.db,"dev-aya",now),now),undefined,"declining removes next-stage commitment");
});
