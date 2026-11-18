import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, type Page } from "playwright";
import { migrate, openLocalD1 } from "../../src/local-d1.ts";
import { listenCatalog } from "../../src/web/server.ts";
import { privateEntries } from "../../src/private/entries.ts";
import { privateText } from "../../src/web/private-i18n.ts";
import { agendaText } from "../../src/web/agenda-i18n.ts";
import { startTestProvider } from "../support/oidc-provider.ts";

test("test-provider browser sign-in returns to the original private page and language; logout and ownership hold", { timeout:90_000 }, async(t)=>{
  const folder=await mkdtemp(join(tmpdir(),"ouahad-oidc-browser-"));
  const d1=await openLocalD1(join(folder,"d1")); await migrate(d1.db);
  // Different site from the app's 127.0.0.1: exercise real cross-site cookie behavior.
  const provider=await startTestProvider(0,"localhost");
  const previous=process.env.NODE_ENV; process.env.NODE_ENV="development";
  const server=await listenCatalog(d1.db,{port:0,authEnvironment:{AUTH_MODE:"test-provider",TEST_OIDC_ISSUER:provider.issuer,
    TEST_OIDC_CLIENT_ID:"test-client",TEST_OIDC_CLIENT_SECRET:"test-secret"}});
  if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
  const browser=await chromium.launch({channel:process.env.OUAHAD_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});
  t.after(async()=>{await browser.close();await server.close();await provider.close();await d1.close();await rm(folder,{recursive:true,force:true});});
  const one=await browser.newContext({viewport:{width:390,height:844}}),two=await browser.newContext();
  const page=await one.newPage(),other=await two.newPage();
  page.setDefaultTimeout(8000); other.setDefaultTimeout(8000);
  const errors:string[]=[];page.on("pageerror",(error)=>errors.push(error.message));
  const ar=privateText.ar;
  async function approve(target:Page,identity:string){
    await target.getByRole("button",{name:ar.continueTest,exact:true}).click();
    await target.waitForURL((url)=>url.origin===provider.issuer);
    assert.equal(new URL(target.url()).origin,provider.issuer);
    await target.getByLabel("Test account").selectOption(identity);
    await target.getByRole("button",{name:"Approve test sign-in",exact:true}).click();
  }
  await page.goto(server.url+"/my/new?lang=fr");
  assert.equal(await page.getByRole("button",{name:privateText.fr.continueTest}).isVisible(),true);
  assert.equal(await page.getByText("Aya",{exact:true}).count(),0);
  await page.getByRole("link",{name:"العربية",exact:true}).click();
  await approve(page,"one");
  assert.equal(new URL(page.url()).pathname,"/my/new");
  assert.equal(new URL(page.url()).searchParams.get("lang"),"ar");
  assert.equal(await page.locator("html").getAttribute("dir"),"rtl");
  await page.getByLabel(ar.title,{exact:true}).fill("Provider science — PRIVATE TEST");
  await page.getByLabel(ar.domain,{exact:true}).fill("Science / العلوم");
  await page.getByLabel(ar.stageName,{exact:true}).fill("Private stage");
  await page.getByRole("button",{name:ar.add,exact:true}).click();
  const entryPath=new URL(page.url()).pathname;
  assert.match(entryPath,/^\/my\/entries\//);
  assert.equal(await page.locator("h1 bdi[dir=auto]").innerText(),"Provider science — PRIVATE TEST");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const screenshots=process.env.OUAHAD_BROWSER_SCREENSHOTS;
  if(screenshots){await mkdir(screenshots,{recursive:true});await page.screenshot({path:join(screenshots,"provider-arabic-mobile.png"),fullPage:true});}
  await other.goto(server.url+"/my?lang=ar");await approve(other,"two");
  assert.equal(await other.getByRole('heading',{name:agendaText.ar.emptyTitle}).isVisible(),true);
  assert.equal((await other.request.get(server.url+entryPath)).status(),404);
  const csrf=await other.locator('input[name="csrf"]').first().inputValue();
  const user=await d1.db.prepare("SELECT user_id FROM provider_identities WHERE subject='test-provider-one'").first<string>("user_id");
  const stage=(await privateEntries(d1.db,user!))[0]!.stages[0]!.key;
  const denied=await other.request.post(server.url+entryPath+"/progress",{headers:{Origin:server.url},form:{csrf,stage,field:"application",value:"submitted"}});
  assert.equal(denied.status(),404);
  assert.doesNotMatch(await(await other.request.get(server.url+"/")).text(),/Provider science/);
  assert.equal((await other.request.get(server.url+"/hackathons/"+entryPath.split("/").at(-1))).status(),404);
  const before=await one.cookies();
  await page.getByRole("button",{name:ar.signout,exact:true}).click();
  assert.equal(new URL(page.url()).pathname,"/sign-in");
  assert.equal(new URL(page.url()).searchParams.get("lang"),"ar");
  assert.equal(await page.getByRole("button",{name:ar.continueTest}).isVisible(),true);
  const revoked=await page.request.get(server.url+entryPath,{headers:{Cookie:before.map((item)=>item.name+"="+item.value).join("; ")},maxRedirects:0});
  assert.equal(revoked.status(),303);
  await approve(page,"one");
  assert.equal(new URL(page.url()).pathname,entryPath,"re-authentication returns to the original saved entry");
  assert.equal(new URL(page.url()).searchParams.get("lang"),"ar");
  assert.ok(provider.counters.jwks>0);
  assert.deepEqual(errors,[]);
});
