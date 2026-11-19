import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { codeMail } from "../../src/email/copy.ts";
import { renderReminder } from "../../src/private/reminders.ts";
import { previewReminder } from "../../scripts/preview-emails.ts";

test("email presentation fits desktop/mobile in EN FR AR with blocked images, readable text, LTR codes and stage actions", {timeout:90_000}, async t => {
  const browser = await chromium.launch({channel:process.env.OUAHAD_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined)});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("https://hackathons.ouahad.space/icons/*", route => route.abort());
  for (const width of [320,390,1024]) for (const lang of ["en","fr","ar"] as const) {
    await page.setViewportSize({width,height:900});
    const verification = codeMail("000000","reminder-address",lang).html!;
    for (const [kind,html] of [["verification",verification],["reminder",renderReminder(previewReminder(lang,false,lang === "ar"),"https://hackathons.ouahad.space",true).html!],["schedule-change",renderReminder(previewReminder(lang,true),"https://hackathons.ouahad.space",true).html!]]) {
      await page.setContent(html!, {waitUntil:"load"});
      assert.equal(await page.locator("html").getAttribute("lang"),lang);
      assert.equal(await page.locator("html").getAttribute("dir"),lang === "ar" ? "rtl" : "ltr");
      const state = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,text:document.body.innerText,background:getComputedStyle(document.body).backgroundColor,images:Array.from(document.images).map(img=>img.naturalWidth)}));
      assert.ok(state.scroll <= state.width+1,`${kind}/${lang} overflows at ${width}px`);
      assert.equal(state.background,"rgb(247, 245, 239)"); assert.ok(state.text.includes("OUAHAD SPACE"));
      assert.ok(state.images.every(value=>value===0),"Blocked images leave the brand readable as text");
      if (kind === "verification") {
        assert.equal(await page.locator("a").count(),0);
        const code = page.getByText("000000",{exact:true}); assert.equal(await code.evaluate(element=>getComputedStyle(element).direction),"ltr");
      } else {
        const action = page.locator("a").first(), box = await action.boundingBox();
        assert.ok(box && box.height>=48); assert.match((await action.getAttribute("href"))!,/#stage-preview-stage$/);
        assert.equal(await page.locator("a").count(),2);
        if(lang === "ar" && kind === "reminder")assert.ok(!/\d\d:\d\d/.test(state.text),"Date-only Arabic fixture must not gain a time");
      }
    }
  }
  const long = previewReminder("ar"); const payload = JSON.parse(long.payload); payload.title = "LongLatinName".repeat(18); payload.stage = "مرحلة ".repeat(30); long.payload = JSON.stringify(payload);
  await page.setViewportSize({width:320,height:900}); await page.setContent(renderReminder(long,"https://hackathons.ouahad.space",true).html!);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Long official names wrap on narrow screens");
});
