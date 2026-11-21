import assert from "node:assert/strict";
import { test } from "node:test";
import { migrate,openLocalD1 } from "../src/local-d1.ts";
import { importIntoD1,inspectEdition,decideRevision } from "../src/catalog-write.ts";
import { manualSource } from "../src/sources.ts";
import { publicCatalog } from "../src/catalog-read.ts";
import { filterCatalog,parseFilters,detail,home } from "../src/web/catalog-page.ts";
import { catalogHandler } from "../src/web/catalog-handler.ts";
import { authConfig } from "../src/private/auth-config.ts";
import { newSession } from "../src/private/session.ts";

const now=new Date("2026-11-19T12:00:00Z");
test("deadline order uses open direct-stage cutoffs, never event starts, and keeps unknown cutoffs open",async t=>{
 const d1=await openLocalD1(false);t.after(d1.close);await migrate(d1.db);
 await importIntoD1(d1.db,[manualSource("data/launch-catalog.json")],{now});
 const id="add-open-data:hackathon-open-data-2026",draft=await inspectEdition(d1.db,id);await decideRevision(d1.db,"publish",id,draft.pendingId!,null,now);
 const base=(await publicCatalog(d1.db,"all",{now}))[0]!;
 const item=(title:string,deadline:string|null,eventStart:string,open=true)=>({...structuredClone(base),id:title,title,confirmedOpen:open,status:open?"open" as const:"unknown" as const,stages:[{...structuredClone(base.stages[0]!),eventStart,registrationDeadline:deadline,status:open?"open" as const:"unknown" as const}]});
 const rows=[item("unknown open",null,"2026-11-20"),item("late cutoff","2026-12-01","2026-11-21"),item("early cutoff","2026-11-21","2027-01-01"),item("unconfirmed","2026-11-20","2026-11-20",false)];
 assert.deepEqual(filterCatalog(rows,parseFilters(new URLSearchParams()),"/").matching.map(x=>x.title),["early cutoff","late cutoff","unknown open","unconfirmed"]);
 assert.deepEqual(filterCatalog(rows,parseFilters(new URLSearchParams("status=open")),"/").matching.map(x=>x.title),["early cutoff","late cutoff","unknown open"]);
 const rendered=home("/",rows,parseFilters(new URLSearchParams()),0);
 assert.ok(rendered.includes("unknown open"));assert.ok(rendered.includes("Cutoff unconfirmed"));
 assert.doesNotMatch(rendered,/Project submission deadline|class="topics"|class="listing-summary"/);
 const stageSpecific=structuredClone(rows[1]!);stageSpecific.stages.push({...stageSpecific.stages[0]!,entry:"advancement",registrationDeadline:"2026-11-19"});
 assert.equal(filterCatalog([stageSpecific,rows[2]!],parseFilters(new URLSearchParams()),"/").matching[0]!.title,"early cutoff");
});

test("decision panels keep archive context, correct actions and signed-out return to the exact event",async t=>{
 const d1=await openLocalD1(false);t.after(d1.close);await migrate(d1.db);
 await importIntoD1(d1.db,[manualSource("data/launch-catalog.json")],{now});
 for(const id of ["add-open-data:hackathon-open-data-2026","geek-room:infer-a-thon-2026","hcp-tta:datathon-data-territoires-2026"]){const draft=await inspectEdition(d1.db,id);await decideRevision(d1.db,"publish",id,draft.pendingId!,null,now);}
 const auth=authConfig({AUTH_MODE:"demo",AUTH_ORIGIN:"http://127.0.0.1:4199"},true);if(auth.mode!=="demo")throw Error();
 const path="/hackathons/add-open-data%3Ahackathon-open-data-2026?lang=ar&q=data&audience=morocco&sort=event";
 const response=await catalogHandler(new Request("http://127.0.0.1:4199"+path),d1.db,{auth,now:()=>now});const html=await response.text();
 assert.equal(response.status,200);assert.ok(html.includes(encodeURIComponent(path).replace(/&/g,"&amp;")));assert.ok(html.includes('class="button save-button"'));
 const user=await newSession(d1.db,"dev-aya",now,null,auth.policy);
 const signed=await catalogHandler(new Request("http://127.0.0.1:4199"+path,{headers:{Cookie:user.setCookie}}),d1.db,{auth,now:()=>now});
 assert.ok((await signed.text()).includes("/my/save?editionId="));
 assert.equal((await d1.db.prepare("SELECT count(*) AS n FROM private_entries").first())?.n,0,"Opening a detail/Save link cannot submit or save an application");
 const [closed]=(await publicCatalog(d1.db,"archive",{now}));const closedHtml=detail(closed!);
 assert.ok(closedHtml.includes('aria-current="page">Archive'));assert.doesNotMatch(closedHtml,/class="button apply-button"|class="check-organizer"/);
 const unknown={...(await publicCatalog(d1.db,"all",{id:"add-open-data:hackathon-open-data-2026",now}))[0]!,confirmedOpen:false,status:"unknown" as const};
 assert.ok(detail(unknown).includes('class="check-organizer"'));assert.doesNotMatch(detail(unknown),/class="button apply-button"/);
 const multi=(await publicCatalog(d1.db,"all",{id:"geek-room:infer-a-thon-2026",now}))[0]!;const multiHtml=detail(multi);
 assert.match(multiHtml,/Building phase/);assert.match(multiHtml,/Final presentations/);assert.match(multiHtml,/Advance from/);assert.match(multiHtml,/Date only/);
 assert.ok(multiHtml.indexOf('class="decision-eligibility"')<multiHtml.indexOf('class="button apply-button"'));
 const mismatched=detail(multi,{filters:parseFilters(new URLSearchParams("audience=morocco")),section:"/"});assert.ok(mismatched.includes("Infer-a-thon"));
});
