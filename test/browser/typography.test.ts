import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile,mkdir,writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { openLocalD1,migrate } from "../../src/local-d1.ts";
import { importIntoD1,inspectEdition,decideRevision } from "../../src/catalog-write.ts";
import { manualSource } from "../../src/sources.ts";
import { listenCatalog } from "../../src/web/server.ts";

test("typography A/B: real font faces, available weights, readable scale, identical content and RTL fallback",{timeout:120_000},async t=>{
 const d1=await openLocalD1(false);t.after(d1.close);await migrate(d1.db);const now=()=>new Date("2026-11-19T12:00:00Z");
 await importIntoD1(d1.db,[manualSource("data/launch-catalog.json")],{now:now()});
 for(const id of ["add-open-data:hackathon-open-data-2026","geek-room:infer-a-thon-2026","hcp-tta:datathon-data-territoires-2026"]){const draft=await inspectEdition(d1.db,id);await decideRevision(d1.db,"publish",id,draft.pendingId!,null,now());}
 const old=process.env.NODE_ENV;process.env.NODE_ENV="development";
 const a=await listenCatalog(d1.db,{port:0,now,developmentAuth:true});
 const b=await listenCatalog(d1.db,{port:0,now,developmentAuth:true,typographyCss:await readFile("public/typography.css","utf8")+"\n"+await readFile("public/typography-b.css","utf8")});
 if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;t.after(a.close);t.after(b.close);
 const browser=await chromium.launch({channel:process.env.OUAHAD_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});t.after(()=>browser.close());
 const page=await browser.newPage();const cdp=await page.context().newCDPSession(page);await cdp.send("DOM.enable");await cdp.send("CSS.enable");
 const report:unknown[]=[];
 const fonts=async(selector:string)=>{const {root}=await cdp.send("DOM.getDocument");const {nodeId}=await cdp.send("DOM.querySelector",{nodeId:root.nodeId,selector});return (await cdp.send("CSS.getPlatformFontsForNode",{nodeId})).fonts;};
 for(const [variant,app]of [["A",a],["B",b]] as const)for(const width of [1280,390])for(const lang of ["en","fr","ar"] as const){
  await page.setViewportSize({width,height:1000});await page.goto(app.url+"/?lang="+lang);await page.evaluate(()=>document.fonts.ready);
  const audit=await page.evaluate(()=>{const out:Record<string,{size:number;weight:number;family:string;spacing:string;lineHeight:number}>={};for(const [key,selector]of Object.entries({heading:"h1",title:".card h3",body:".intro-copy",control:".search-input input",metadata:".card-route",deadline:".row-cutoff dd",brand:".brand-section"})){const s=getComputedStyle(document.querySelector(selector)!);out[key]={size:parseFloat(s.fontSize),weight:Number(s.fontWeight),family:s.fontFamily,spacing:s.letterSpacing,lineHeight:parseFloat(s.lineHeight)};}return out;});
  assert.equal(audit.heading!.size,width===1280?44:32);assert.equal(audit.heading!.weight,700);
  assert.equal(audit.title!.size,width===1280?24:22);assert.ok(audit.title!.weight>=600);
  assert.ok(audit.body!.size>=16&&audit.body!.size<=17);assert.ok(audit.control!.size>=15);
  assert.ok(audit.metadata!.size>=14&&audit.metadata!.size<=15);assert.ok(audit.deadline!.size>=18&&audit.deadline!.size<=20);assert.ok(audit.deadline!.weight>=600);
  assert.equal(audit.heading!.spacing,"normal");assert.equal(audit.title!.spacing,"normal");
  assert.equal(audit.brand!.family,"Georgia, serif","Existing brand typography stays untouched");
  const renderedHeading=await fonts("h1"),renderedTitle=await fonts(".card h3 bdi"),renderedBody=await fonts(".intro-copy");
  const expected=lang==="ar"?"IBM Plex Sans Arabic":variant==="A"?"Plus Jakarta Sans":"Inter";
  assert.ok(renderedHeading.length>0);assert.ok(renderedTitle.length>0);
  assert.ok(renderedHeading.every(f=>f.isCustomFont&&f.familyName===expected),`${variant}/${lang}: heading fell back: ${JSON.stringify(renderedHeading)}`);
  assert.ok(renderedTitle.every(f=>f.isCustomFont&&f.familyName===expected));
  assert.ok(renderedBody.every(f=>f.isCustomFont&&f.familyName===(lang==="ar"?"IBM Plex Sans Arabic":"Inter")));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const twin=await page.request.get((variant==="A"?b:a).url+"/?lang="+lang);assert.equal(await twin.text(),await(await page.request.get(app.url+"/?lang="+lang)).text(),"A/B HTML and data are identical");
  report.push({variant,width,lang,audit,renderedHeading,renderedTitle,renderedBody});
 }
 await mkdir(".local/typography-review",{recursive:true});await writeFile(".local/typography-review/rendered-font-audit.json",JSON.stringify(report,null,2));
 await page.setViewportSize({width:320,height:1000});await page.goto(a.url+"/hackathons/geek-room%3Ainfer-a-thon-2026?lang=ar");await page.evaluate(()=>document.fonts.ready);
 assert.equal((await fonts("h1 bdi"))[0]!.familyName,"IBM Plex Sans Arabic");
 const fallback=await browser.newContext();await fallback.route("**/fonts/*",route=>route.abort());const withoutFonts=await fallback.newPage();
 const fallbackSession=await fallback.newCDPSession(withoutFonts);await fallbackSession.send("DOM.enable");await fallbackSession.send("CSS.enable");const fallbackReport=[];
 await withoutFonts.setViewportSize({width:320,height:1000});
 for(const lang of ["en","ar"]){
  await withoutFonts.goto(a.url+"/hackathons/geek-room%3Ainfer-a-thon-2026?lang="+lang);await withoutFonts.evaluate(()=>document.fonts.ready);
  assert.equal(await withoutFonts.evaluate(language=>document.fonts.check(language==="ar"?'700 32px "IBM Plex Sans Arabic"':'700 32px "Plus Jakarta Sans"'),lang),false,"The custom face really is blocked in the fresh context");
  assert.ok(await withoutFonts.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok((await withoutFonts.locator(".apply-button").boundingBox())!.height>=44);
  const {root}=await fallbackSession.send("DOM.getDocument");const {nodeId}=await fallbackSession.send("DOM.querySelector",{nodeId:root.nodeId,selector:"h1 bdi"});
  const actual=(await fallbackSession.send("CSS.getPlatformFontsForNode",{nodeId})).fonts;
  assert.ok(actual.length>0&&actual.every(font=>!font.isCustomFont),"Blocked custom files render real system fallback glyphs");fallbackReport.push({lang,actual});
 }
 await writeFile(".local/typography-review/fallback-font-audit.json",JSON.stringify(fallbackReport,null,2));
 await fallback.close();
});
