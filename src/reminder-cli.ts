import { openLocalD1 } from "./local-d1.ts";
import { reconcileUserReminders, reminderMessages, runReminderJob } from "./private/reminders.ts";

const usage = "npm.cmd run reminders -- plan|run|inspect|outbox [--user internal-id] [--now ISO-timestamp] [--origin http://127.0.0.1:4177]";
async function main(){
  const [command,...args]=process.argv.slice(2);
  if(command==="--help"){console.log(usage);return;}
  if(!["plan","run","inspect","outbox"].includes(command??""))throw new Error(usage);
  const options=new Map<string,string>();
  for(let i=0;i<args.length;i+=2){
    const key=args[i]!,value=args[i+1];
    if(!["--user","--now","--origin"].includes(key)||!value||options.has(key))throw new Error(usage);
    options.set(key,value);
  }
  if(process.env.NODE_ENV!=="development"||process.env.EMAIL_SIGNIN_MODE!=="capture")throw new Error("Local reminder commands require NODE_ENV=development and EMAIL_SIGNIN_MODE=capture");
  const time=options.get("--now");
  if(time&&(!/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(time)||!Number.isFinite(Date.parse(time))))throw new Error("Use an exact ISO timestamp with an offset");
  const now=time?new Date(time):new Date(),origin=options.get("--origin")??process.env.AUTH_ORIGIN??"http://127.0.0.1:4177";
  const url=new URL(origin);
  if(url.protocol!=="http:"||!["127.0.0.1","localhost"].includes(url.hostname))throw new Error("HTTP loopback origin required");
  if(command==="run"&&options.has("--user"))throw new Error("The job rechecks all accounts; --user is for inspection or planning");
  const runtime=await openLocalD1(process.env.OUAHAD_D1_PATH);
  try{
    const user=options.get("--user"),users=(await runtime.db.prepare("SELECT id FROM private_users WHERE (? IS NULL OR id=?) ORDER BY id").bind(user??null,user??null).all<{id:string}>()).results;
    let result:unknown;
    if(command==="run")result=await runReminderJob(runtime.db,{now,origin,capture:true});
    else if(command==="outbox")result=(await Promise.all(users.map(({id})=>reminderMessages(runtime.db,id)))).flat();
    else{
      if(command==="plan")for(const {id}of users)await reconcileUserReminders(runtime.db,id,now,true);
      result={transport:"local-capture",now:now.toISOString(),accounts:users.length,reminders:(await runtime.db.prepare(`SELECT user_id,entry_id,stage_key,generation,kind,state,reason,due_at,expires_at,updated_at FROM stage_reminders WHERE (? IS NULL OR user_id=?) ORDER BY due_at,id`).bind(user??null,user??null).all()).results};
    }
    console.log(JSON.stringify(result,null,2));
  }finally{await runtime.close();}
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Reminder command failed");process.exitCode=1;});
