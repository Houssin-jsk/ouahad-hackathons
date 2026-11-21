import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir,writeFile } from 'node:fs/promises';
import { chromium,webkit } from 'playwright';
import sharp from 'sharp';
import { openLocalD1,migrate } from '../../src/local-d1.ts';
import { listenCatalog } from '../../src/web/server.ts';
import { authConfig } from '../../src/private/auth-config.ts';
import { newSession } from '../../src/private/session.ts';
import { addExternal,privateEntries,updateProgress } from '../../src/private/entries.ts';
import { importIntoD1,inspectEdition,decideRevision } from '../../src/catalog-write.ts';
import { manualSource } from '../../src/sources.ts';

for(const channel of ['chrome','msedge','webkit'])test(`approved UI rendering and responsive journeys: Windows ${channel}`,{timeout:300_000},async t=>{
 const runtime=await openLocalD1(false);await migrate(runtime.db);t.after(runtime.close);
 const now=()=>new Date('2026-11-19T12:00:00Z');
 await importIntoD1(runtime.db,[manualSource('data/launch-catalog.json')],{now:now()});
 const catalogId='add-open-data:hackathon-open-data-2026';const draft=await inspectEdition(runtime.db,catalogId);await decideRevision(runtime.db,'publish',catalogId,draft.pendingId!,null,now());
 const env={AUTH_MODE:'google',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret'};
 const old=process.env.NODE_ENV;process.env.NODE_ENV='development';const app=await listenCatalog(runtime.db,{port:0,now,authEnvironment:env});if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;t.after(app.close);
 const config=authConfig({...env,AUTH_ORIGIN:app.url},true);if(config.mode!=='google')throw new Error('UI test auth disabled');const policy=config.policy;
 for(const id of ['usr_ui_populated','usr_ui_empty'])await runtime.db.prepare("INSERT INTO private_users VALUES (?,?,'provider')").bind(id,'UI test').run();
 const entryId=await addExternal(runtime.db,'usr_ui_populated',{title:'Technology Sprint — اختبار التقنيات',domain:'Data / البيانات',eventUrl:'https://example.org/',stage:{name:'Final — النهائي',eventStart:'2026-12-01',eventEnd:'2026-12-02',timeZone:'Africa/Casablanca',format:'online',entry:'direct',requiresStage:null,fixedAttendance:true}},now());
 const stage=(await privateEntries(runtime.db,'usr_ui_populated',now(),entryId))[0]!.stages[0]!.key;
 await updateProgress(runtime.db,'usr_ui_populated',entryId,stage,'application','submitted',now());await updateProgress(runtime.db,'usr_ui_populated',entryId,stage,'decision','accepted',now());
 const browser=channel==='webkit'?await webkit.launch():await chromium.launch({channel});t.after(()=>browser.close());
 const context=await browser.newContext(),empty=await browser.newContext();
 for(const [ctx,user]of [[context,'usr_ui_populated'],[empty,'usr_ui_empty']] as const){const session=await newSession(runtime.db,user,now(),null,policy);await ctx.addCookies([{name:'ouahad_provider_session',value:session.setCookie.split(';')[0]!.split('=')[1]!,url:app.url,httpOnly:true,sameSite:'Lax'}]);}
 const page=await context.newPage(),publicPage=await browser.newPage(),emptyPage=await empty.newPage();
 const folder=`.local/ui-release/${channel}`;await mkdir(folder,{recursive:true});
 const audit:unknown[]=[];let painted=0;
 const cdp=channel==='webkit'?null:await context.newCDPSession(page);if(cdp){await cdp.send('DOM.enable');await cdp.send('CSS.enable');}
 const actualFonts=async(selector:string)=>{if(!cdp)return [];const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});return (await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;};
 const paths=[['catalog','/'],['archive','/archive'],['detail','/hackathons/'+encodeURIComponent(catalogId)],['my','/my'],['create','/my/new'],['stage','/my/entries/'+entryId],['settings','/my/email-settings'],['signin','/sign-in'],['empty','/my']] as const;
 await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce'});
 for(const lang of ['en','ar'])for(const path of ['/my','/my/new','/my/entries/'+entryId,'/my/email-settings']){
  await page.setViewportSize({width:390,height:1000});await page.goto(app.url+path+'?lang='+lang);await page.evaluate(()=>{document.documentElement.style.fontSize='200%'});
  const reflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,bad:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).slice(0,15).map(e=>({tag:e.tagName,cls:e.getAttribute('class'),rect:e.getBoundingClientRect().toJSON()}))}));assert.ok(reflow.scroll<=reflow.width+1,`200% text: ${path}/${lang}: ${JSON.stringify(reflow)}`);
 }
 for(const lang of ['en','fr','ar'])for(const width of [320,360,375,390,430,768,1024,1440,1920])for(const [name,path]of paths){
  const target=name==='signin'?publicPage:name==='empty'?emptyPage:page;
  await target.setViewportSize({width,height:1000});await target.goto(app.url+path+'?lang='+lang);await target.evaluate(()=>document.fonts.ready);
  const overflow=await target.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,bad:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).slice(0,5).map(e=>({tag:e.tagName,cls:e.className}))}));
  assert.ok(overflow.scroll<=width+1,`${channel}/${name}/${lang}/${width}: ${JSON.stringify(overflow)}`);
  const smallControls=await target.locator('.private-shell :is(.btn,input:not([type=hidden]):not([type=checkbox]),select)').evaluateAll(nodes=>nodes.filter(e=>e.getBoundingClientRect().width>0&&parseFloat(getComputedStyle(e).fontSize)<15).map(e=>e.getAttribute('class')));assert.deepEqual(smallControls,[],`Readable controls: ${name}/${lang}/${width}`);
  assert.equal(await target.locator('html').getAttribute('lang'),lang);assert.equal(await target.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
  if(target===page&&['my','create','stage','settings'].includes(name)&&[390,1440].includes(width)){
   const fonts=await actualFonts('h1');if(cdp)assert.ok(fonts.some(f=>f.isCustomFont&&f.familyName===(lang==='ar'?'IBM Plex Sans Arabic':'Plus Jakarta Sans')),JSON.stringify({name,lang,fonts}));else assert.ok(await page.evaluate(language=>document.fonts.check(language==='ar'?'700 32px "IBM Plex Sans Arabic"':'700 32px "Plus Jakarta Sans"'),lang));
   const heading=await page.locator('h1').evaluate(e=>({size:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight}));assert.equal(heading.size,width===390?'32px':'44px');assert.equal(heading.weight,'700');audit.push({name,lang,width,fonts,heading});
  }
  if(channel==='chrome'&&[390,1440].includes(width))await target.screenshot({path:`${folder}/${name}-${lang}-${width}.png`,fullPage:true});
  if(name==='stage'&&width===390){assert.equal(await target.locator('input[name=startTime]').first().inputValue(),'');assert.equal(await target.locator('input[type=date]').first().inputValue(),'2026-12-01');}
 }
 // Painted pixels, rather than SVG markup alone, in normal/dark/forced-colors environments.
 for(const mode of ['light','dark','contrast'] as const){
  await page.emulateMedia({colorScheme:mode==='dark'?'dark':'light',forcedColors:mode==='contrast'?'active':'none'});await page.setViewportSize({width:1440,height:1000});
  for(const path of ['/','/?q=data&status=open','/hackathons/'+encodeURIComponent(catalogId),'/my','/my/new','/my/entries/'+entryId,'/my/email-settings']){
   await page.goto(app.url+path+(path.includes('?')?'&':'?')+'lang=ar');await page.evaluate(()=>document.fonts.ready);
   for(const svg of await page.locator('svg.ui-icon,svg.catalog-icon').all()){
    if(!await svg.isVisible())continue;
    const style=await svg.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,stroke:getComputedStyle(e).stroke,hidden:e.getAttribute('aria-hidden'),focus:e.getAttribute('focusable')}));assert.ok(style.width>=20&&style.height>=20,JSON.stringify({path,mode,style}));assert.notEqual(style.stroke,'none');assert.equal(style.hidden,'true');assert.equal(style.focus,'false');
    const {data,info}=await sharp(await svg.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true});const colors=new Set();for(let i=0;i<data.length;i+=info.channels)colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);assert.ok(colors.size>1,'SVG must paint visible pixels');painted++;
   }
  }
  await page.screenshot({path:`${folder}/icons-${mode}-ar.png`,fullPage:true});
 }
 await page.goto(app.url+'/my/new');const button=page.locator('button.btn-primary').first();await button.focus();assert.ok(await button.evaluate(e=>parseFloat(getComputedStyle(e).outlineWidth)>=2));assert.ok((await button.boundingBox())!.height>=44);
 await writeFile(`${folder}/render-audit.json`,JSON.stringify({browser:browser.version(),channel,viewports:[320,360,375,390,430,768,1024,1440,1920],painted,fonts:audit},null,2));
});
