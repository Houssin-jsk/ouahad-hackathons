import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { migrate,openLocalD1 } from "../../src/local-d1.ts";
import { importIntoD1,inspectEdition,decideRevision } from "../../src/catalog-write.ts";
import { manualSource } from "../../src/sources.ts";
import { phase1Sources } from "../../src/phase1-seed.ts";
import { listenCatalog } from "../../src/web/server.ts";
import { messages } from "../../src/web/i18n.ts";
import { catalogCopy } from "../../src/web/catalog-copy.ts";
import { privateEntries } from "../../src/private/entries.ts";
import { publicCatalog } from "../../src/catalog-read.ts";
import { home,parseFilters } from "../../src/web/catalog-page.ts";

test("deadline agenda: native controls, responsive headers, RTL, text reflow, blocked fonts, private save and honest actions",{timeout:180_000},async t=>{
 const d1=await openLocalD1(false);t.after(d1.close);await migrate(d1.db);const now=()=>new Date("2026-11-19T12:00:00Z");
 await importIntoD1(d1.db,await phase1Sources(),{now:now(),seedOnly:true});
 await importIntoD1(d1.db,[manualSource("data/launch-catalog.json")],{now:now()});
 for(const id of ["add-open-data:hackathon-open-data-2026","geek-room:infer-a-thon-2026","hcp-tta:datathon-data-territoires-2026","ibn-zohr-fsa:technovate-blue-tech-2026","hack-united:united-hacks-v8","github-game-off:game-off-2026"]){const draft=await inspectEdition(d1.db,id);await decideRevision(d1.db,"publish",id,draft.pendingId!,null,now());}
 const old=process.env.NODE_ENV;process.env.NODE_ENV="development";const server=await listenCatalog(d1.db,{port:0,now,developmentAuth:true});if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;t.after(server.close);
 const browser=await chromium.launch({channel:process.env.OUAHAD_BROWSER_CHANNEL||(process.platform==="win32"?"msedge":undefined)});t.after(()=>browser.close());
 const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();page.setDefaultTimeout(8000);
 const add="/hackathons/add-open-data%3Ahackathon-open-data-2026",infer="/hackathons/geek-room%3Ainfer-a-thon-2026",tech="/hackathons/ibn-zohr-fsa%3Atechnovate-blue-tech-2026",closed="/hackathons/hcp-tta%3Adatathon-data-territoires-2026";
 const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Page reflows without horizontal scrolling");
 for(const width of [1280,320,360,390]) for(const lang of ["en","fr","ar"] as const){
  const m=messages[lang],c=catalogCopy[lang];await page.setViewportSize({width,height:1000});await page.goto(server.url+"/?lang="+lang);
  await overflow();assert.equal(await page.locator("html").getAttribute("dir"),lang==="ar"?"rtl":"ltr");
  const header=await page.evaluate(()=>({brand:document.querySelector(".brand-lockup")!.getBoundingClientRect().toJSON(),language:document.querySelector(".language-control")!.getBoundingClientRect().toJSON(),label:document.querySelector(".brand-section")!.getBoundingClientRect().toJSON()}));
  assert.ok(lang==="ar"?header.brand.left>=header.language.right:header.brand.right<=header.language.left,"Brand and language control have separate columns");
  assert.ok(lang==="ar"?header.label.left>=header.language.right:header.label.right<=header.language.left,`Project wordmark does not overlap language control (${width}/${lang}): ${JSON.stringify(header)}`);
  assert.equal((await page.locator(".card h3").allTextContents())[0],"Hackathon Open Data 2026");
  assert.equal(await page.getByRole("switch",{name:c.openOnly,exact:true}).isVisible(),true);
  assert.equal(await page.locator(".cards .listing-summary,.cards .topics,.cards .timing").count(),0);
  if(width<768){const bounds=await page.locator(".card").first().evaluate(node=>({status:node.querySelector(".row-status")!.getBoundingClientRect().bottom,cutoff:node.querySelector(".row-cutoff")!.getBoundingClientRect().top}));assert.ok(bounds.cutoff>=bounds.status);}
  assert.ok((await page.locator(".card-details").first().evaluate(node=>getComputedStyle(node).textDecorationLine)).includes("underline"));
  if(width===320){assert.equal(await page.locator(".mobile-navigation > summary").isVisible(),true);assert.ok((await page.locator(".mobile-navigation > summary").innerText()).includes(m.catalog));await page.locator(".mobile-navigation > summary").click();assert.equal(await page.locator(".mobile-navigation").getByRole("link",{name:c.my,exact:true}).isVisible(),true);await page.locator(".mobile-navigation > summary").click();}
  else assert.equal(await page.locator(".desktop-navigation").getByRole("link",{name:m.catalog,exact:true}).isVisible(),true);
  await page.locator(".filter-panel > summary").click();
  const position=await page.evaluate(()=>({panel:document.querySelector(".filter-fields")!.getBoundingClientRect().bottom,results:document.querySelector(".results-head")!.getBoundingClientRect().top}));assert.ok(position.panel<=position.results);
  await page.getByLabel(m.city,{exact:true}).selectOption("Rabat");await page.getByRole("button",{name:m.apply,exact:true}).click();assert.equal(await page.locator(".card").count(),1);assert.equal(await page.locator(".chip").count(),1);
  await page.getByRole("link",{name:m.details+": Hackathon Open Data 2026",exact:true}).click();
  assert.ok((await page.getByRole("link",{name:m.backCatalog,exact:true}).getAttribute("href"))?.includes("city=Rabat"));
  assert.equal(await page.getByRole("link",{name:m.applyOfficial,exact:true}).isVisible(),true);
  assert.equal(await page.locator(".save-button .catalog-icon").evaluate(node=>getComputedStyle(node).transform),"none");
  assert.equal(await page.locator(".back .catalog-icon").evaluate(node=>getComputedStyle(node).transform),lang==="ar"?"matrix(-1, 0, 0, 1, 0, 0)":"none");
  const icon=page.locator(".apply-button .catalog-icon");assert.ok((await icon.locator("path").count())>0);assert.equal(await icon.evaluate(node=>getComputedStyle(node).stroke),"rgb(255, 255, 255)");assert.equal(await icon.evaluate(node=>getComputedStyle(node).transform),"none");
  const positions=await page.evaluate(()=>({head:document.querySelector(".detail-head")!.getBoundingClientRect().bottom,panel:document.querySelector(".decision-panel")!.getBoundingClientRect().toJSON(),body:document.querySelector(".detail-body")!.getBoundingClientRect().top}));
  if(width<768){assert.ok(positions.panel.top>=positions.head);assert.ok(positions.body>=positions.panel.bottom);}
  assert.ok((await page.locator(".apply-button").boundingBox())!.height>=44);assert.ok((await page.locator(".save-button").boundingBox())!.height>=44);await overflow();
 }
 await page.setViewportSize({width:390,height:1000});await page.goto(server.url+"/?q=data&audience=morocco&city=Rabat&sort=event");
 await page.locator(".language-control > summary").click();await page.getByRole("link",{name:"Français",exact:true}).click();assert.equal(new URL(page.url()).searchParams.get("sort"),"event");assert.equal(new URL(page.url()).searchParams.get("city"),"Rabat");
 await page.getByRole("switch").click();assert.equal(new URL(page.url()).searchParams.get("status"),"open");await page.getByRole("link",{name:messages.fr.details+": Hackathon Open Data 2026",exact:true}).click();
 const eventPath=new URL(page.url()).pathname+new URL(page.url()).search;
 await page.locator(".save-button").click();assert.equal(new URL(page.url()).searchParams.get("next"),eventPath);
 await page.getByRole("button",{name:"Se connecter",exact:true}).click();assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,eventPath);
 assert.equal((await privateEntries(d1.db,"dev-aya",now())).length,0,"Sign-in return does not save or apply automatically");
 await page.locator(".save-button").click();await page.locator(".save-card form button").click();assert.equal((await privateEntries(d1.db,"dev-aya",now())).length,1);assert.equal((await privateEntries(d1.db,"dev-aya",now()))[0]!.stages[0]!.application,"not-submitted");
 await page.goto(server.url+tech);assert.equal(await page.locator(".apply-button").count(),0);assert.equal(await page.locator(".check-organizer").isVisible(),true);
 await page.goto(server.url+closed);assert.equal(await page.locator(".apply-button,.check-organizer").count(),0);assert.equal(await page.locator(".decision-source").isVisible(),true);assert.equal(await page.locator(".desktop-navigation a[aria-current]").innerText(),"Archive");
 await page.goto(server.url+infer+"?lang=ar");assert.equal(await page.locator(".detail-panel").count(),2);assert.ok((await page.locator(".decision-panel").innerText()).includes(catalogCopy.ar.dateOnly));assert.ok(!/\d\d:\d\d/.test(await page.locator(".decision-cutoff").innerText()));
 // Blocked fonts and reduced motion in a separate context; layout remains usable with JS on/off.
 const fallback=await browser.newContext({reducedMotion:"reduce"});await fallback.route("**/fonts/*",route=>route.abort());const alternate=await fallback.newPage();
 await alternate.setViewportSize({width:320,height:1000});await alternate.goto(server.url+infer+"?lang=ar");
 await alternate.evaluate(()=>{document.documentElement.style.fontSize="200%";});
 const reflow=await alternate.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,outside:[...document.querySelectorAll("body *")].filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left < -1);}).map(node=>({tag:node.tagName,classes:node.getAttribute("class"),parent:node.parentElement?.getAttribute("class"),text:node.tagName==="BDI"?node.textContent?.slice(0,50):undefined,width:node.getBoundingClientRect().width,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})).slice(0,15)}));
 assert.ok(reflow.scroll<=reflow.width+1,"200% text reflows with fonts blocked: "+JSON.stringify(reflow));
 assert.equal(await alternate.locator(".cutoff-star").evaluate(node=>getComputedStyle(node).animationName),"none");
 const long=structuredClone((await publicCatalog(d1.db,"all",{id:"add-open-data:hackathon-open-data-2026",now:now()}))[0]!);
 long.title="فرصة للابتكار — "+"VeryLongOfficialHackathonName".repeat(12);
 await alternate.evaluate(()=>{document.documentElement.style.fontSize="";});
 await alternate.goto(server.url+"/");await alternate.setContent(home("/",[long],parseFilters(new URLSearchParams("lang=ar")),0));
 assert.ok(await alternate.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Long mixed-direction official names wrap with blocked fonts");
 await page.goto(server.url+"/");await page.locator(".card-details").first().focus();
 assert.equal(await page.locator(".card-details").first().evaluate(node=>getComputedStyle(node).outlineStyle),"solid");
 assert.ok(Number.parseFloat(await page.locator(".card-details").first().evaluate(node=>getComputedStyle(node).outlineWidth))>=2);
 await page.keyboard.press("Enter");await page.waitForURL(url=>url.pathname===add);assert.equal(new URL(page.url()).pathname,add);
 await page.goto(server.url+"/?q=data&audience=morocco");await page.getByRole("switch").focus();await page.keyboard.press("Space");await page.waitForURL(url=>url.searchParams.get("status")==="open");
 assert.equal(new URL(page.url()).searchParams.get("q"),"data");
 await page.getByRole("switch").focus();await page.keyboard.press("Space");await page.waitForURL(url=>!url.searchParams.has("status"));
 assert.equal(new URL(page.url()).searchParams.get("audience"),"morocco");
 await alternate.goto(server.url+"/");await alternate.keyboard.press("Tab");assert.equal(await alternate.locator(".skip-link").evaluate(node=>node===document.activeElement),true);assert.notEqual(await alternate.locator(".skip-link").evaluate(node=>getComputedStyle(node).outlineStyle),"none");
 await alternate.locator(".search-input input").focus();await alternate.keyboard.press("Tab");assert.equal(await alternate.locator(".search-submit").evaluate(node=>node===document.activeElement),true);
 await fallback.close();
 assert.equal((await page.request.get(server.url+"/hackathons/think-ai%3Athink-ai-morocco-2024")).status(),404);
});
