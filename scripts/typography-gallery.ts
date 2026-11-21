import { createServer } from "node:http";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Review artifact server only. No catalog, account or delivery code is invoked.
export async function startTypographyGallery(){
 const folder=resolve(".local/typography-review");await mkdir(folder,{recursive:true});
 const rows=[];
 for(const lang of ["en","fr","ar"] as const)for(const size of ["desktop","mobile"] as const)for(const page of ["catalog","detail"] as const){
  const id=`${page}-${lang}-${size}`,label=`${page==="catalog"?"Catalog":"Event detail"} · ${{en:"English",fr:"Français",ar:"العربية"}[lang]} · ${size}`;
  rows.push({id,label,markup:`<section id="${id}"><h2>${label}</h2><div class="pair">${["A","B"].map(v=>`<figure><figcaption>${v} · ${v==="A"?"Plus Jakarta Sans + Inter":"Inter throughout EN/FR"}</figcaption><a href="/captures/${v}-${id}.jpg"><img src="/captures/${v}-${id}.jpg" alt="Variant ${v}, ${label}" loading="lazy"></a></figure>`).join("")}</div></section>`});
 }
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ouahad typography comparison</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:32px auto;padding:0 20px;max-width:1400px;background:#F7F5EF;color:#10212B}a{color:#077F64;text-underline-offset:3px}h1{font-size:32px;line-height:1.3}h2{font-size:22px;margin-top:40px}nav{display:flex;gap:10px 20px;flex-wrap:wrap}section{scroll-margin-top:20px;border-top:1px solid #d5d5ce;margin-top:32px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0;min-width:0}figcaption{font-weight:600;padding:12px 0}img{width:100%;height:auto;display:block;border:1px solid #d5d5ce}section[id*=mobile] img{max-width:390px}@media(max-width:600px){.pair{gap:12px}figcaption{font-size:14px}body{padding:0 12px}}</style></head><body><p>OUAHAD HACKATHONS / LOCAL TYPE REVIEW</p><h1>Two type systems. The same agenda.</h1><p><a href="http://127.0.0.1:4186/">Open working variant A</a> · <a href="http://127.0.0.1:4187/">Open working variant B</a></p><p>Identical D1 records, fixed clock, layout, palette and actions. A uses Plus Jakarta Sans headings; B uses Inter headings. Both use Inter for EN/FR reading and controls, and IBM Plex Sans Arabic for Arabic. Captures: 1280×1000 desktop and 390×1000 mobile. These are browser emulations, not physical-device tests.</p><nav aria-label="Comparisons">${rows.map(r=>`<a href="#${r.id}">${r.label}</a>`).join("")}</nav>${rows.map(r=>r.markup).join("")}</body></html>`;
 await writeFile(resolve(folder,"index.html"),html);
 const server=createServer(async(req,res)=>{
  if(!["GET","HEAD"].includes(req.method??"GET")){res.writeHead(405).end();return;}
  const path=new URL(req.url??"/","http://local").pathname;
  const name=/^\/captures\/([AB]-(?:catalog|detail)-(?:en|fr|ar)-(?:desktop|mobile)\.jpg)$/.exec(path)?.[1];
  try{
   const body=path==="/"?Buffer.from(html):name?await readFile(resolve(folder,name)):null;
   if(!body){res.writeHead(404).end();return;}
   res.writeHead(200,{"Content-Type":name?"image/jpeg":"text/html; charset=utf-8","Cache-Control":"no-store"}).end(req.method==="HEAD"?undefined:body);
  }catch{res.writeHead(404).end();}
 });
 await new Promise<void>((done,fail)=>{server.once("error",fail);server.listen(4191,"127.0.0.1",()=>{server.off("error",fail);done();});});
 return {url:"http://127.0.0.1:4191",close:()=>server.close()};
}
