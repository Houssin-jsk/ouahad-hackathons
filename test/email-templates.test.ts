import assert from "node:assert/strict";
import { test } from "node:test";
import { codeMail, deliveryText } from "../src/email/copy.ts";
import { reminderHtml } from "../src/email/templates.ts";
import { renderReminder, reconcileUserReminders, setVerifiedReminderAddress, setReminderPreferences } from "../src/private/reminders.ts";
import { reminderDate, reminderText } from "../src/private/reminder-copy.ts";
import { previewReminder } from "../scripts/preview-emails.ts";
import { openLocalD1, migrate } from "../src/local-d1.ts";
import { addExternal, privateEntries, updateProgress } from "../src/private/entries.ts";
import { resendConfig } from "../src/email/config.ts";
import { enqueueEmail, type Envelope } from "../src/email/queue.ts";
import { planLiveReminders, dispatchTransactionalEmail } from "../src/email/service.ts";
import { emailId, unseal } from "../src/email/crypto.ts";

test("verification HTML keeps localized text/subjects and isolates escaped codes without a CTA", () => {
  for (const lang of ["en", "fr", "ar"] as const) {
    const message = codeMail("000000", "reminder-address", lang);
    assert.equal(message.subject, deliveryText[lang].verifySubject);
    assert.equal(message.text, "000000\n\n" + deliveryText[lang].expires);
    assert.match(message.html!, new RegExp(`<html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}">`));
    assert.match(message.html!, /<p dir="ltr"[^>]*>000000<\/p>/);
    assert.ok(message.html!.includes(deliveryText[lang].expires));
    assert.doesNotMatch(message.html!, /<a\b|<script|<style|<svg|data:/i);
    assert.equal(codeMail("000000", "signin", lang).html, undefined, "email login presentation is unchanged");
  }
  const malicious = codeMail('<img src=x onerror="alert(1)">', "reminder-address", "ar").html!;
  assert.ok(malicious.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.doesNotMatch(malicious, /<img src=x/);
});

test("reminder HTML uses real stage links, Morocco exact times, date-only precision, escaping and honest corrections", () => {
  for (const lang of ["en", "fr", "ar"] as const) for (const changed of [false, true]) {
    const row = previewReminder(lang, changed), rendered = renderReminder(row, "https://hackathons.ouahad.space", true);
    const p = JSON.parse(row.payload), t = reminderText[lang], isolate = (s:string) => lang === "ar" ? "\u2068" + s + "\u2069" : s;
    const stageUrl = new URL(`/my/entries/${row.entry_id}`, "https://hackathons.ouahad.space"), settingsUrl = new URL("/my/email-settings", stageUrl);
    if (lang !== "en") { stageUrl.searchParams.set("lang", lang); settingsUrl.searchParams.set("lang", lang); } stageUrl.hash = "stage-" + row.stage_key;
    const dates = [p.start,p.end].map(value => reminderDate(value,lang)).join(" — ");
    assert.equal(rendered.subject, `${changed?t.changeSubject:t.subject}: ${isolate(p.stage)} — ${isolate(p.title)}`);
    assert.equal(rendered.body, [changed?deliveryText[lang].scheduleChange:t.acceptedCopy,`${t.opportunity}: ${isolate(p.title)}`,`${t.event}: ${isolate(p.stage)}`,`${t.eventDates}: ${isolate(dates)}`,t.exactPolicy,`${t.view}: ${isolate(stageUrl.href)}`,`${t.manage}: ${isolate(settingsUrl.href)}`].join("\n\n"));
    assert.ok(rendered.html!.includes(stageUrl.href)); assert.ok(rendered.html!.includes(settingsUrl.href));
    assert.ok(rendered.html!.includes(reminderDate(p.start,lang))); assert.ok(rendered.html!.includes(t.morocco));
    assert.equal((rendered.html!.match(/<a /g) ?? []).length, 2);
    assert.doesNotMatch(rendered.html!, /<style|<script|<svg|flex|grid|@import/i);
  }
  const dateOnly = renderReminder(previewReminder("ar", false, true), "https://hackathons.ouahad.space", true).html!;
  assert.ok(dateOnly.includes(reminderText.ar.dateLabel)); assert.doesNotMatch(dateOnly, /09:00|٠٩:٠٠|Morocco time|توقيت المغرب/);
  const row = previewReminder("en"); const data = JSON.parse(row.payload); data.title = 'Atlas <script>alert("x")</script> & Co'; data.stage = '<img src=x onerror="x">'; data.start = null; data.end = null; row.payload = JSON.stringify(data);
  const escaped = renderReminder(row, "https://hackathons.ouahad.space", true).html!;
  assert.doesNotMatch(escaped, /<script|<img src=x/); assert.ok(escaped.includes("&lt;script&gt;")); assert.ok(escaped.includes("Date not yet known"));
  assert.throws(() => reminderHtml({language:"en",title:"test",stage:"test",start:null,end:null,changed:false,notice:"test",stageUrl:"javascript:alert(1)",settingsUrl:"https://hackathons.ouahad.space"}), /Invalid email link/);
});

test("new templates never retrofit an existing pending/retry envelope or its provider body and idempotency key", async t => {
  const runtime = await openLocalD1(false); t.after(runtime.close); await migrate(runtime.db); const db = runtime.db;
  const config = resendConfig({EMAIL_DELIVERY_MODE:"resend",RESEND_API_KEY:"test-only",EMAIL_ENCRYPTION_KEY:Buffer.alloc(32,6).toString("base64url"),EMAIL_FROM:"Ouahad Hackathons <no-reply@notify.ouahad.space>"})!;
  const now = new Date("2026-12-11T10:00:00Z");
  await db.prepare("INSERT INTO private_users VALUES ('usr_template','Template test','provider')").run();
  const entry = await addExternal(db,"usr_template",{title:"Template fixture",domain:"data",eventUrl:null,stage:{name:"Final",eventStart:"2026-12-12T09:00:00Z",eventEnd:"2026-12-12T17:00:00Z",timeZone:"Africa/Casablanca",format:"online",entry:"direct",requiresStage:null,fixedAttendance:true}},now);
  const key = (await privateEntries(db,"usr_template",now,entry))[0]!.stages[0]!.key;
  await updateProgress(db,"usr_template",entry,key,"decision","accepted",now);
  await setVerifiedReminderAddress(db,"usr_template","template@example.invalid",now,"resend"); await setReminderPreferences(db,"usr_template",true,"en","resend",now);
  const row = (await reconcileUserReminders(db,"usr_template",now,"resend")).rows[0]!, plain = renderReminder(row,"https://hackathons.ouahad.space",true);
  const id = await enqueueEmail(db,config,"reminder",emailId([row.id,row.generation,row.payload]),{to:["template@example.invalid"],subject:plain.subject,text:plain.body},new Date(row.expires_at!),now,{user:row.user_id,reminder:row.id,generation:row.generation,reminderPayload:row.payload});
  const cipher = () => db.prepare("SELECT encrypted_payload FROM email_deliveries WHERE id=?").bind(id).first<string>("encrypted_payload");
  const original = (await cipher())!;
  await planLiveReminders(db,config,"https://hackathons.ouahad.space",now);
  assert.equal(await cipher(),original,"pending legacy ciphertext remains byte-identical");
  assert.equal(unseal<Envelope>(original,config.encryptionKey,id).mail.html,undefined);
  const bodies:string[] = [], keys:string[] = [];
  const fetcher:typeof fetch = async (_url,init) => { bodies.push(String(init?.body)); keys.push(new Headers(init?.headers).get("Idempotency-Key")!); if(bodies.length===1)throw new TypeError("simulated timeout"); return Response.json({id:"template-test"}); };
  assert.equal((await dispatchTransactionalEmail(db,config,id,{now,fetcher})).state,"retry_wait");
  await planLiveReminders(db,config,"https://hackathons.ouahad.space",new Date(now.getTime()+6000));
  assert.equal(await cipher(),original,"replanning cannot rewrite a retry payload");
  assert.equal((await dispatchTransactionalEmail(db,config,id,{now:new Date(now.getTime()+6000),fetcher})).state,"provider_accepted");
  assert.equal(bodies[0],bodies[1]); assert.equal(keys[0],keys[1]); assert.equal(JSON.parse(bodies[1]!).html,undefined);
  // A fresh logical message freezes its HTML too, even if rendered differently on re-enqueue.
  const fresh = await enqueueEmail(db,config,"reminder-address","new-html",{to:["template@example.invalid"],...codeMail("000000","reminder-address","fr")},new Date(now.getTime()+600000),now);
  const originalNew = (await db.prepare("SELECT encrypted_payload FROM email_deliveries WHERE id=?").bind(fresh).first<string>("encrypted_payload"))!;
  await enqueueEmail(db,config,"reminder-address","new-html",{to:["template@example.invalid"],subject:"different",text:"different",html:"<p>different</p>"},new Date(now.getTime()+600000),now);
  assert.equal(await db.prepare("SELECT encrypted_payload FROM email_deliveries WHERE id=?").bind(fresh).first<string>("encrypted_payload"),originalNew);
  assert.ok(unseal<Envelope>(originalNew,config.encryptionKey,fresh).mail.html?.includes('lang="fr"'));
});
