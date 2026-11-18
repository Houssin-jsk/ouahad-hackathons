import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { openLocalD1 } from "./local-d1.ts";
import { resendConfig,type ResendConfig } from "./email/config.ts";
import { dispatchTransactionalEmail,planLiveReminders,runTransactionalEmailJob } from "./email/service.ts";
import { deliveryStatus } from "./email/queue.ts";
import { requestEmailCode } from "./private/email-codes.ts";
import { newSession } from "./private/session.ts";
import type { ProviderConfig } from "./private/auth-config.ts";

const usage="npm.cmd run email -- inspect|plan|run|smoke signin|smoke reminder [--to owner-address] [--reminder plan-id] [--send]";
export function validateSmoke(config:ResendConfig,address:string){const recipient=address.trim().toLowerCase();if(!recipient||!config.ownerAddresses.includes(recipient))throw new Error("Exact owner-controlled address must be configured in EMAIL_OWNER_ADDRESSES");return recipient;}
async function main(){
 const args=process.argv.slice(2),command=args.shift();if(command==="--help"){console.log(usage);return;}
 const kind=command==="smoke"?args.shift():undefined;
 if(!["inspect","plan","run","smoke"].includes(command??"")||command==="smoke"&&!["signin","reminder"].includes(kind??""))throw new Error(usage);
 const options=new Map<string,string>();let send=false;
 while(args.length){const key=args.shift()!;if(key==="--send"){if(send)throw new Error(usage);send=true;continue;}const value=args.shift();if(!["--to","--reminder"].includes(key)||!value||options.has(key))throw new Error(usage);options.set(key,value);}
 const raw=resendConfig(process.env);
 if(!raw)throw new Error("Resend is disabled or incompletely configured. No email sent.");
 const config={...raw,ownerOnly:true},origin=process.env.AUTH_ORIGIN??"https://hackathons.ouahad.space";
 const originUrl=new URL(origin),localOrigin=process.env.NODE_ENV==="development"&&originUrl.protocol==="http:"&&["127.0.0.1","localhost"].includes(originUrl.hostname);
 if(originUrl.origin!==origin||originUrl.protocol!=="https:"&&!localOrigin)throw new Error("An exact HTTPS or development loopback AUTH_ORIGIN is required for smoke links");
 if(command==="smoke"){
  const recipient=validateSmoke(config,options.get("--to")??"");
  if(kind==="reminder"&&!options.has("--reminder"))throw new Error("Select one existing accepted-stage plan using --reminder");
  if(!send){console.log(JSON.stringify({state:"dry_run",kind,ownerAddressAllowed:true,maximumMessages:1,note:"Add --send only after sender verification and authorization. No network request made."}));return;}
  if(process.env.EMAIL_SMOKE_ALLOWED!=="true")throw new Error("Live smoke requires EMAIL_SMOKE_ALLOWED=true and explicit --send");
  const runtime=await openLocalD1(process.env.OUAHAD_D1_PATH??".local/d1-email-smoke");
  try{
   const now=new Date();
   if(kind==="signin"){
    const policy={mode:"provider" as const,realm:"owner-resend-smoke",secure:true};
    const session=(await newSession(runtime.db,null,now,null,policy)).session;
    const auth:ProviderConfig={mode:"google",origin,issuer:"https://accounts.google.com",clientId:"smoke-only",clientSecret:"",policy,emailLive:config};
    const requested=await requestEmailCode(runtime.db,auth,session,recipient,"/my",now);
    if(requested.status==="limited"){console.log(JSON.stringify({state:"rate_limited"}));return;}
    const row=await runtime.db.prepare("SELECT id FROM email_deliveries WHERE challenge_id=?").bind(requested.id).first<string>("id");
    console.log(JSON.stringify({kind:"signin",delivery:row?await deliveryStatus(runtime.db,row):null,note:"Mailbox smoke only. Session cookie and code are never printed; use the browser flow to test actual sign-in."}));
   }else{
    const selected=await runtime.db.prepare(`SELECT r.id FROM stage_reminders r JOIN email_reminder_settings s ON s.user_id=r.user_id WHERE r.id=? AND s.delivery_email=? AND s.verification_kind='mailbox-code' AND s.reminders_enabled=1`).bind(options.get("--reminder")!,recipient).first();
    if(!selected)throw new Error("A matching mailbox-verified, opted-in accepted-stage plan is required");
    const ids=await planLiveReminders(runtime.db,config,origin,now,[recipient]);
    const job=await runtime.db.prepare("SELECT id FROM email_deliveries WHERE reminder_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 1").bind(options.get("--reminder")!,JSON.stringify(ids)).first<string>("id");
    if(!job)throw new Error("The selected reminder is not currently due and eligible");
    console.log(JSON.stringify(await dispatchTransactionalEmail(runtime.db,config,job,{now})));
   }
  }finally{await runtime.close();}return;
 }
 if(send||options.size)throw new Error(usage);
 const runtime=await openLocalD1(process.env.OUAHAD_D1_PATH??".local/d1-email-smoke");
 try{
  if(command==="inspect")console.log(JSON.stringify({deliveries:(await runtime.db.prepare("SELECT id,kind,user_id,reminder_id,generation,state,attempts,next_attempt_at,provider_id,accepted_at,error_code FROM email_deliveries ORDER BY created_at DESC LIMIT 100").all()).results,provider:(await runtime.db.prepare("SELECT next_request_at,blocked_until,blocked_reason FROM email_transport_state").first()),budgets:(await runtime.db.prepare("SELECT bucket,lane,count(*) AS reserved FROM email_budget_reservations GROUP BY bucket,lane ORDER BY bucket DESC").all()).results},null,2));
  else if(command==="plan"){await planLiveReminders(runtime.db,config,origin);console.log(JSON.stringify((await runtime.db.prepare("SELECT id,user_id,entry_id,stage_key,state,due_at FROM stage_reminders ORDER BY due_at").all()).results,null,2));}
  else{if(process.env.EMAIL_SMOKE_ALLOWED!=="true")throw new Error("Sending is off; EMAIL_SMOKE_ALLOWED=true is required for the owner-only runner");console.log(JSON.stringify(await runTransactionalEmailJob(runtime.db,config,{origin}),null,2));}
 }finally{await runtime.close();}
}
// Importing the validation helper in tests never invokes the CLI or a network request.
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Email command failed");process.exitCode=1;});
