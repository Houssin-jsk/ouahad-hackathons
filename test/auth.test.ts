import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { Miniflare, Response as RuntimeResponse, Request as RuntimeRequest, type MiniflareOptions } from "miniflare";
import { migrate, openLocalD1 } from "../src/local-d1.ts";
import { listenCatalog } from "../src/web/server.ts";
import { catalogHandler } from "../src/web/catalog-handler.ts";
import { authConfig } from "../src/private/auth-config.ts";
import { cookie, findSession, newSession } from "../src/private/session.ts";
import { addExternal, privateEntries } from "../src/private/entries.ts";
import { safeReturn } from "../src/private/oidc.ts";
import { signedTestProvider, startTestProvider, type Fault } from "./support/oidc-provider.ts";

type Send = (path: string, cookie?: string, body?: Record<string,string>) => Promise<Response>;
const mergeCookies = (previous: string, response: Response) => {
  const values = new Map(previous.split("; ").filter(Boolean).map((part) => part.split("=", 2) as [string,string]));
  for (const value of response.headers.getSetCookie()) { const [key, content] = value.split(";", 1)[0]!.split("=", 2); values.set(key!, content!); }
  return [...values].map(([key,value]) => key + "=" + value).join("; ");
};
async function beginLogin(send: Send, follow: (location: string) => Promise<Response>, identity = "one", next = "/my/new?lang=ar") {
  const pre = await send("/sign-in?lang=ar&next=" + encodeURIComponent(next));
  assert.equal(pre.status, 200);
  let cookie = mergeCookies("", pre);
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(await pre.text())![1]!;
  const start = await send("/sign-in?lang=ar", cookie, { csrf, next });
  assert.equal(start.status, 303);
  cookie = mergeCookies(cookie, start);
  const authorize = new URL(start.headers.get("location")!); authorize.searchParams.set("identity", identity);
  assert.equal(authorize.searchParams.get("ui_locales"), "ar");
  const grant = await follow(authorize.href);
  const callback = new URL(grant.headers.get("location")!);
  return { cookie, callback, csrf };
}
async function login(send: Send, follow: (location: string) => Promise<Response>, identity = "one", next = "/my/new?lang=ar") {
  const started = await beginLogin(send,follow,identity,next);
  const completed = await send(started.callback.pathname + started.callback.search, started.cookie);
  return { ...started, completed, cookie: mergeCookies(started.cookie, completed), priorCookie: started.cookie };
}

test("signed test-provider flow: stable issuer/subject IDs, isolation, callback defenses, logout and invalid sessions", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "ouahad-auth-"));
  const d1 = await openLocalD1(join(folder,"d1")); await migrate(d1.db);
  const provider = await startTestProvider();
  const old = process.env.NODE_ENV; process.env.NODE_ENV = "development";
  const server = await listenCatalog(d1.db, { port: 0, authEnvironment: {
    AUTH_MODE: "test-provider", TEST_OIDC_ISSUER: provider.issuer, TEST_OIDC_CLIENT_ID: "test-client", TEST_OIDC_CLIENT_SECRET: "test-secret",
  } });
  if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old;
  t.after(async () => { await server.close(); await provider.close(); await d1.close(); await rm(folder,{recursive:true,force:true}); });
  const send: Send = (path, cookie = "", body) => fetch(server.url + path, { redirect:"manual", method:body ? "POST":"GET",
    headers:{Cookie:cookie, Origin:server.url}, ...(body ? {body:new URLSearchParams(body)}:{}) });
  const follow = (url: string) => fetch(url,{redirect:"manual"});
  const first = await login(send,follow);
  assert.equal(first.completed.status,303);
  assert.equal(first.completed.headers.get("location"),"/my/new?lang=ar");
  assert.notEqual(first.cookie,first.priorCookie);
  assert.ok(provider.counters.jwks > 0,"ID token signature actually checked against JWKS");
  assert.equal((await send("/my",first.priorCookie)).status,303,"pre-authentication session rotated");
  const own = await send("/my",first.cookie), ownHtml = await own.text();
  assert.match(ownHtml,/Provider One/); assert.doesNotMatch(ownHtml,/Aya|Sami/);
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(ownHtml)![1]!;
  const user = await d1.db.prepare("SELECT user_id FROM provider_identities WHERE subject = 'test-provider-one'").first<string>("user_id");
  assert.match(user!,/^usr_/);
  const external = await addExternal(d1.db,user!,{title:"Private provider entry",domain:"science",eventUrl:null,stage:{
    name:"Event",eventStart:null,eventEnd:null,timeZone:null,format:"unknown",entry:"direct",requiresStage:null,fixedAttendance:false,
  }});
  const second = await login(send,follow,"two");
  assert.equal(second.completed.status,303);
  assert.equal((await send("/my/entries/"+external,second.cookie)).status,404);
  const secondHtml = await (await send("/my",second.cookie)).text();
  const otherCsrf = /name="csrf" value="([a-f0-9]+)"/.exec(secondHtml)![1]!;
  const privateStage = (await privateEntries(d1.db,user!))[0]!.stages[0]!.key;
  assert.equal((await send(`/my/entries/${external}/progress`,second.cookie,{csrf:otherCsrf,stage:privateStage,field:"decision",value:"accepted"})).status,404);
  assert.equal((await d1.db.prepare("SELECT count(*) AS n FROM provider_identities").first())?.n,2,"same email does not merge subjects");
  provider.setEmail("changed-address@example.test");
  const again = await login(send,follow);
  assert.equal(again.completed.status,303);
  assert.equal((await send("/my/entries/"+external,again.cookie)).status,200);
  assert.equal((await d1.db.prepare("SELECT count(*) AS n FROM provider_identities").first())?.n,2,"changed email preserves identity");
  assert.equal((await send(first.callback.pathname+first.callback.search,first.priorCookie)).status,403,"callback replay rejected");
  for(const fault of ["nonce","issuer","audience","expired","signature","denied"] as Fault[]) {
    provider.setFault(fault);
    const rejected = await login(send,follow);
    assert.equal(rejected.completed.status,400,fault);
    assert.equal((await send("/my",rejected.cookie)).status,303,fault+" creates no authenticated session");
  }
  provider.setFault("none");
  const pending = await beginLogin(send,follow);
  const callbackPath = pending.callback.pathname + pending.callback.search;
  const noBrowser = pending.cookie.split("; ").filter((part)=>!part.startsWith("ouahad_oidc=")).join("; ");
  assert.equal((await send(callbackPath,noBrowser)).status,403,"missing browser binding");
  assert.equal((await send(callbackPath,second.cookie)).status,403,"callback cannot switch another browser's account");
  const repeated = await Promise.all([send(callbackPath,pending.cookie),send(callbackPath,pending.cookie)]);
  assert.deepEqual(repeated.map((result)=>result.status).sort(),[303,403],"only one parallel callback succeeds");
  const expiredTransaction = await beginLogin(send,follow);
  await d1.db.prepare("UPDATE auth_transactions SET expires_at = '2000-01-01T00:00:00Z'").run();
  assert.equal((await send(expiredTransaction.callback.pathname+expiredTransaction.callback.search,expiredTransaction.cookie)).status,403);
  assert.equal((await send("/auth/callback?state="+"a".repeat(64)+"&code=fake",first.cookie)).status,403);
  assert.equal((await send("/my","ouahad_provider_session="+"a".repeat(64))).status,303);
  assert.equal((await send("/sign-out",first.cookie,{csrf:"wrong"})).status,403);
  const out = await send("/sign-out?lang=ar",first.cookie,{csrf,next:"/my/new?lang=ar"});
  assert.equal(out.status,303); assert.equal(out.headers.get("location"),"/my/new?lang=ar");
  assert.equal((await send("/my",first.cookie)).status,303);
  assert.doesNotMatch(await (await send("/")).text(),/Private provider entry/);
  assert.equal((await send("/hackathons/"+external)).status,404);
  for (const value of ["//evil.test/","https://evil.test/","/\\evil.test/","/auth/callback","/%2f%2fevil.test"]) assert.equal(safeReturn(value),"/my");
  const anotherProvider=await startTestProvider();
  process.env.NODE_ENV="development";
  const anotherApp=await listenCatalog(d1.db,{port:0,authEnvironment:{AUTH_MODE:"test-provider",TEST_OIDC_ISSUER:anotherProvider.issuer,
    TEST_OIDC_CLIENT_ID:"test-client",TEST_OIDC_CLIENT_SECRET:"test-secret"}});
  if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;
  t.after(async()=>{await anotherApp.close();await anotherProvider.close();});
  const anotherSend:Send=(path,cookie="",body)=>fetch(anotherApp.url+path,{redirect:"manual",method:body?"POST":"GET",
    headers:{Cookie:cookie,Origin:anotherApp.url},...(body?{body:new URLSearchParams(body)}:{})});
  const differentIssuer=await login(anotherSend,follow);
  assert.equal(differentIssuer.completed.status,303);
  const mappings=(await d1.db.prepare("SELECT user_id FROM provider_identities WHERE subject='test-provider-one'").all<{user_id:string}>()).results;
  assert.equal(mappings.length,2);
  assert.notEqual(mappings[0]!.user_id,mappings[1]!.user_id,"same subject at a different issuer is a separate account");
  assert.equal((await anotherSend("/my/entries/"+external,differentIssuer.cookie)).status,404);
});

test("the production Worker entrypoint completes signed-provider callbacks in local workerd and D1", async (t) => {
  const origin="https://hackathons.ouahad.space";
  // Controlled stand-in at Google's logical endpoints. No traffic is sent to Google.
  const provider=signedTestProvider("https://accounts.google.com",{
    authorization:"https://accounts.google.com/o/oauth2/v2/auth",token:"https://oauth2.googleapis.com/token",jwks:"https://www.googleapis.com/oauth2/v3/certs",
  });
  const bundle=await build({entryPoints:[fileURLToPath(new URL("../src/sync-worker.ts",import.meta.url))],bundle:true,write:false,
    format:"esm",platform:"neutral",mainFields:["module","main"],conditions:["workerd","worker","browser"],external:["node:crypto"]});
  const options: MiniflareOptions={host:"127.0.0.1",port:0,modules:true,script:bundle.outputFiles[0]!.text,compatibilityDate:"2026-11-17",
    compatibilityFlags:["nodejs_compat"],d1Databases:{DB:"ouahad-catalog-local"},d1Persist:false,
    bindings:{AUTH_MODE:"google",AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret"},
    outboundService:async(request: RuntimeRequest)=>{
      const response=await provider.handle(new Request(request.url,{method:request.method,headers:{"Content-Type":request.headers.get("content-type")??""},
        ...(request.method==="POST"?{body:await request.text()}:{})}));
      return new RuntimeResponse(await response.text(),{status:response.status,headers:Object.fromEntries(response.headers)});
    },
  };
  const runtime=new Miniflare(options);
  t.after(()=>runtime.dispose());
  const db=await runtime.getD1Database("DB"); await migrate(db);
  const send:Send=async(path,cookie="",body)=>{
    const result=await runtime.dispatchFetch(origin+path,{method:body?"POST":"GET",redirect:"manual",
      headers:{Cookie:cookie,Origin:origin,...(body?{"Content-Type":"application/x-www-form-urlencoded"}:{})},
      ...(body?{body:new URLSearchParams(body).toString()}:{})});
    const headers=new Headers();
    for(const [key,value] of result.headers) if(key!=="set-cookie") headers.append(key,value);
    for(const value of result.headers.getSetCookie()) headers.append("Set-Cookie",value);
    return new Response(new Uint8Array(await result.arrayBuffer()),{status:result.status,headers});
  };
  const first=await login(send,(url)=>provider.handle(new Request(url)));
  assert.equal(first.completed.status,303);
  assert.match(first.completed.headers.getSetCookie().join("\n"),/__Host-ouahad_session=.*; Secure/);
  assert.match(await(await send("/my",first.cookie)).text(),/Provider One/);
  assert.equal((await send("/",first.cookie)).status,200);
  assert.equal((await send("/",first.cookie,{publish:"anything"})).status,405);
  assert.ok(provider.counters.jwks>0);
  const html=await(await send("/my",first.cookie)).text();
  const csrf=/name="csrf" value="([a-f0-9]+)"/.exec(html)![1]!;
  assert.equal((await send("/sign-out",first.cookie,{csrf})).status,303);
  assert.equal((await send("/my",first.cookie)).status,303);
  await runtime.setOptions({...options,bindings:{AUTH_MODE:"demo",AUTH_ORIGIN:origin,GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret"}});
  const rejected=await send("/sign-in");
  assert.equal(rejected.status,503); assert.doesNotMatch(await rejected.text(),/Aya|Sami/);
});

test("migration retains Phase 5 demo ownership and history without claiming them for provider users", async (t) => {
  const d1=await openLocalD1(false); t.after(d1.close);
  await d1.db.prepare("CREATE TABLE catalog_migrations (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL)").run();
  for(const name of ["0001_catalog.sql","0002_sync.sql","0003_private.sql"]) {
    const sql=await readFile(new URL("../migrations/"+name,import.meta.url),"utf8");
    await d1.db.batch([...sql.split(/^-- statement-break\s*$/m).map((part)=>part.trim()).filter(Boolean).map((part)=>d1.db.prepare(part)),
      d1.db.prepare("INSERT INTO catalog_migrations VALUES (?, ?)").bind(name,createHash("sha256").update(sql.replace(/\r\n/g,"\n")).digest("hex"))]);
  }
  await d1.db.prepare("INSERT INTO private_users VALUES ('dev-aya','Aya')").run();
  await d1.db.prepare("INSERT INTO private_entries (id,user_id,snapshot,created_at) VALUES ('legacy','dev-aya',?,?)")
    .bind(JSON.stringify({title:"Legacy private story",domain:"robotics",eventUrl:null,stages:[]}),new Date().toISOString()).run();
  await d1.db.prepare(`INSERT INTO private_stage_progress (entry_id,user_id,stage_key,facts,application,decision,intent,attended,result)
    VALUES ('legacy','dev-aya','main',?,'submitted','accepted','declined',1,'advanced')`)
    .bind(JSON.stringify({key:"main",name:"Historic stage",eventStart:null,eventEnd:null,timeZone:null,format:"unknown",entry:"direct",requiresStage:null,fixedAttendance:false})).run();
  assert.deepEqual(await migrate(d1.db),["0004_provider_auth.sql","0005_local_email_codes.sql", "0006_stage_reminders.sql", "0007_transactional_email.sql"]);
  assert.equal((await privateEntries(d1.db,"dev-aya"))[0]!.id,"legacy");
  const history=(await privateEntries(d1.db,"dev-aya"))[0]!.stages[0]!;
  assert.deepEqual([history.application,history.decision,history.intent,history.attended,history.result],["submitted","accepted","declined",1,"advanced"]);
  assert.equal((await d1.db.prepare("SELECT kind FROM private_users WHERE id='dev-aya'").first())?.kind,"demo");
  assert.equal((await d1.db.prepare("SELECT count(*) AS n FROM provider_identities").first())?.n,0);
  assert.deepEqual((await d1.db.prepare("PRAGMA foreign_key_check").all()).results,[]);
});

test("production configuration fails closed; demo cookies and provider sessions never cross realms", async (t) => {
  const d1 = await openLocalD1(false); await migrate(d1.db); t.after(d1.close);
  const demo = await newSession(d1.db,"dev-aya",new Date());
  const env = { AUTH_MODE:"google", AUTH_ORIGIN:"https://hackathons.ouahad.space", GOOGLE_CLIENT_ID:"test-client", GOOGLE_CLIENT_SECRET:"test-secret" };
  const config = authConfig(env,false); assert.equal(config.mode,"google");
  if(config.mode!=="google") throw new Error();
  assert.match(cookie("a".repeat(64),config.policy),/^__Host-ouahad_session=.*; Secure$/);
  assert.equal(await findSession(d1.db,demo.setCookie,new Date(),config.policy),null);
  await assert.rejects(newSession(d1.db,null,new Date(),demo.session,config.policy),/Session is no longer valid/,
    "a demo session cannot be rotated into a provider realm");
  const pre=await newSession(d1.db,null,new Date(),null,config.policy);
  await d1.db.prepare("DELETE FROM private_sessions WHERE token_hash=?").bind(pre.session.token_hash).run();
  await assert.rejects(newSession(d1.db,null,new Date(),pre.session,config.policy),/Session is no longer valid/,
    "an in-flight login cannot revive a revoked session");
  const page = await catalogHandler(new Request(env.AUTH_ORIGIN+"/my",{headers:{Cookie:demo.setCookie}}),d1.db,{auth:config});
  assert.equal(page.status,303);
  const signin = await catalogHandler(new Request(env.AUTH_ORIGIN+"/sign-in"),d1.db,{auth:config});
  assert.match(signin.headers.get("set-cookie")!,/Secure/);
  assert.doesNotMatch(await signin.text(),/Aya|Sami|Test identity/);
  for(const bad of [{...env,GOOGLE_CLIENT_SECRET:""},{...env,AUTH_MODE:"demo"},{...env,AUTH_MODE:"test-provider"},{...env,AUTH_ORIGIN:"http://hackathons.ouahad.space"}]) {
    const auth=authConfig(bad,false); assert.equal(auth.mode,"unavailable");
    const response=await catalogHandler(new Request(env.AUTH_ORIGIN+"/sign-in"),d1.db,{auth});
    assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/Aya|Sami|Test identity/);
  }
  const expired = await newSession(d1.db,null,new Date(Date.now()-9*3600_000),null,config.policy);
  assert.equal(await findSession(d1.db,expired.setCookie,new Date(),config.policy),null);
});
