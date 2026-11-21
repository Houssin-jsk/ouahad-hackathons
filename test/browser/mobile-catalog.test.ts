import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium,webkit } from 'playwright';
import { openLocalD1,migrate } from '../../src/local-d1.ts';
import { importIntoD1,inspectEdition,decideRevision } from '../../src/catalog-write.ts';
import { manualSource } from '../../src/sources.ts';
import { phase1Sources } from '../../src/phase1-seed.ts';
import { listenCatalog } from '../../src/web/server.ts';
import { messages } from '../../src/web/i18n.ts';
import { catalogCopy } from '../../src/web/catalog-copy.ts';

for(const engine of ['Chrome','WebKit'] as const)test(`mobile catalog rhythm, native sort and reflow: ${engine}`,{timeout:180_000},async t=>{
 const runtime=await openLocalD1(false);t.after(runtime.close);await migrate(runtime.db);const now=()=>new Date('2026-11-19T12:00:00Z');
 await importIntoD1(runtime.db,await phase1Sources(),{now:now(),seedOnly:true});await importIntoD1(runtime.db,[manualSource('data/launch-catalog.json')],{now:now()});
 for(const id of ['add-open-data:hackathon-open-data-2026','geek-room:infer-a-thon-2026','github-game-off:game-off-2026','ibn-zohr-fsa:technovate-blue-tech-2026','hack-united:united-hacks-v8','nasa-space-apps:universal-event-2025']){const draft=await inspectEdition(runtime.db,id);await decideRevision(runtime.db,'publish',id,draft.pendingId!,null,now());}
 const app=await listenCatalog(runtime.db,{port:0,now});t.after(app.close);
 const browser=engine==='Chrome'?await chromium.launch({channel:'chrome'}):await webkit.launch();t.after(()=>browser.close());
 const context=await browser.newContext({javaScriptEnabled:false,isMobile:true,hasTouch:true,deviceScaleFactor:3});const page=await context.newPage();page.setDefaultTimeout(8000);
 const reflow=async(label:string)=>{const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,bad:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).slice(0,6).map(e=>({tag:e.tagName,cls:e.getAttribute('class')}))}));assert.ok(result.scroll<=result.width+1,label+': '+JSON.stringify(result));};
 for(const lang of ['en','fr','ar'] as const)for(const width of [320,360,375,390,430]){
  const m=messages[lang],c=catalogCopy[lang];await page.setViewportSize({width,height:844});await page.goto(app.url+'/?lang='+lang);await page.evaluate(()=>document.fonts.ready);
  await reflow(`${lang}/${width}`);assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
  assert.equal(await page.getByRole('link',{name:c.internationalShort,exact:true}).count(),1,'Visible and accessible mobile view names agree');
  assert.equal(await page.locator('.sort-form').isVisible(),false);assert.equal(await page.locator('.mobile-sort').isVisible(),true);
  const nav=await page.locator('.audiences a').evaluateAll(nodes=>nodes.map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})));assert.equal(new Set(nav.map(e=>e.top)).size,1,'All three view labels fit on one row at the approved font size');assert.ok(nav.every(e=>e.height>=44&&e.width>=44));
  for(const control of [page.locator('.search-submit'),page.getByRole('switch'),page.locator('.filter-panel>summary'),...await page.locator('.mobile-sort button').all()])assert.ok((await control.boundingBox())!.height>=44);
  const order=await page.locator('.card').first().evaluate(e=>{const title=e.querySelector('h3')!,place=e.querySelector('.card-place')!,status=e.querySelector('.row-status')!,cutoff=e.querySelector('.row-cutoff')!;return {dom:!!(title.compareDocumentPosition(place)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(place.compareDocumentPosition(status)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(status.compareDocumentPosition(cutoff)&Node.DOCUMENT_POSITION_FOLLOWING),title:title.getBoundingClientRect().bottom,place:place.getBoundingClientRect().top,status:status.getBoundingClientRect().bottom,cutoff:cutoff.getBoundingClientRect().top,size:parseFloat(getComputedStyle(title).fontSize)};});assert.ok(order.dom);assert.ok(order.title<=order.place&&order.status<=order.cutoff);assert.equal(order.size,22,'Approved title size retained');
  const github=page.locator('.card').filter({hasText:'GitHub Game Off 2026'});assert.match(await github.locator('.card-place').innerText(),new RegExp(c.onlineUnknown.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal(await github.locator('.unpublished').innerText(),c.cutoffUnknown);
  assert.ok(await page.locator('.search-input .catalog-icon').evaluate(e=>e.getBoundingClientRect().width===20&&getComputedStyle(e).transform==='none'));
  await page.locator('.filter-panel>summary').click();await reflow('expanded filters');await page.locator('.filter-panel>summary').click();
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%'});await reflow(`200% ${lang}/${width}`);
  await page.locator('.filter-panel>summary').click();await reflow('200% expanded filters');
 }
 for(const lang of ['en','fr','ar'] as const){
  const m=messages[lang],c=catalogCopy[lang];await page.setViewportSize({width:390,height:844});const query=new URLSearchParams({lang,q:'data',audience:'morocco',city:'Rabat',field:'open data',format:'in-person',status:'open'});
  await page.goto(app.url+'/?'+query);const eventSort=page.getByRole('button',{name:c.sort+': '+c.eventSort,exact:true});await eventSort.focus();assert.ok(await eventSort.evaluate(e=>parseFloat(getComputedStyle(e).outlineWidth)>=2));await eventSort.press('Space');await page.waitForURL(url=>url.searchParams.get('sort')==='event');
  const eventUrl=new URL(page.url());for(const [key,value]of query)assert.equal(eventUrl.searchParams.get(key)??(key==='lang'?'en':null),value);assert.deepEqual(eventUrl.searchParams.getAll('sort'),['event']);assert.equal(await eventSort.getAttribute('aria-pressed'),'true');
  await page.locator('.card-details').first().click();await page.getByRole('link',{name:m.backCatalog,exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('sort'),'event');assert.equal(new URL(page.url()).searchParams.get('city'),'Rabat');
  await page.locator('.language-control>summary').click();const other=lang==='ar'?'Français':'العربية';await page.getByRole('link',{name:other,exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('sort'),'event');assert.equal(new URL(page.url()).searchParams.get('field'),'open data');
  await page.goto(app.url+'/?lang='+lang+'&sort=event');await page.getByRole('searchbox',{name:m.search,exact:true}).fill('data');await page.locator('.search-submit').click();await page.waitForURL(url=>url.searchParams.get('q')==='data');assert.equal(new URL(page.url()).searchParams.get('q'),'data');assert.equal(new URL(page.url()).searchParams.get('sort'),'event');
  await page.getByRole('switch').click();await page.waitForURL(url=>url.searchParams.get('status')==='open');assert.equal(new URL(page.url()).searchParams.get('status'),'open');await page.locator('.chip').filter({hasText:m.search}).click();await page.waitForURL(url=>!url.searchParams.has('q'));assert.equal(new URL(page.url()).searchParams.has('q'),false);assert.equal(new URL(page.url()).searchParams.get('status'),'open');await page.locator('.clear-all').click();await page.waitForURL(url=>!url.searchParams.has('status'));assert.equal(new URL(page.url()).searchParams.has('status'),false);
  await page.locator('.filter-panel>summary').click();await page.getByLabel(m.city,{exact:true}).selectOption('Rabat');await page.getByRole('button',{name:m.apply,exact:true}).click();await page.waitForURL(url=>url.searchParams.get('city')==='Rabat');assert.equal(await page.locator('.card').count(),1);
  await page.getByRole('button',{name:c.sort+': '+c.deadlineSort,exact:true}).press('Enter');await page.waitForURL(url=>url.searchParams.get('sort')==='deadline');assert.equal(new URL(page.url()).searchParams.get('sort'),'deadline');
  await page.goto(app.url+'/archive?lang='+lang);await page.getByRole('button',{name:c.sort+': '+c.eventSort,exact:true}).click();assert.equal(new URL(page.url()).pathname,'/archive');assert.equal(new URL(page.url()).searchParams.get('lang')??'en',lang);await page.waitForURL(url=>url.pathname==='/archive'&&url.searchParams.get('sort')==='event');await reflow('archive');
 }
 await page.setViewportSize({width:320,height:844});await page.goto(app.url+'/?lang=fr');await page.locator('.card h3 bdi').first().evaluate(e=>{e.textContent='Innovation Maroc — '+ 'LongOfficialHackathonTitle'.repeat(12)+' — ابتكار'});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await reflow('long mixed title with enlarged text');
 const desktop=await browser.newPage({viewport:{width:1440,height:1000}});await desktop.goto(app.url+'/');assert.equal(await desktop.locator('.sort-form').isVisible(),true);assert.equal(await desktop.locator('.mobile-sort').isVisible(),false);
});
