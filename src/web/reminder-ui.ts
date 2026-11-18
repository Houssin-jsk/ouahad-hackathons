import { emailId } from "../email/crypto.ts";
import { deliveryText, deliveryLabel } from "../email/copy.ts";
import { html, date } from "./catalog-page.ts";
import { icon } from "./private-icons.ts";
import { reminderText } from "../private/reminder-copy.ts";
import { hasDeliveryAddress, type ReminderContext } from "../private/reminders.ts";
import type { TrackedStage } from "../private/entries.ts";
import type { Language } from "./i18n.ts";

export function reminderStatus(context:ReminderContext|undefined,entryId:string,stage:TrackedStage,lang:Language){
  if(!context)return "";
  const t=reminderText[lang],d=deliveryText[lang],row=context.rows.find((item)=>item.entry_id===entryId&&item.stage_key===stage.key);
  const currentId=row?emailId(["resend-v1","reminder",emailId([row.id,row.generation,row.payload])]):null;
  const delivery=context.liveAvailable&&row?context.deliveries?.find((item)=>row.state==="captured"?item.reminder_id===row.id&&item.generation===row.generation&&item.state==="provider_accepted":item.id===currentId):undefined;
  const settingsHref="/my/email-settings"+(lang==="en"?"":"?lang="+lang);
  let state="off",label=t.off,help="",time:string|null=null,href=settingsHref;
  if(stage.unavailable||stage.intent==="declined"||stage.attended||stage.decision!=="accepted"&&row){
    state="cancelled";label=t.cancelled;help=stage.unavailable?t.cancelUnavailable:stage.intent==="declined"?t.cancelDeclined:stage.attended?t.cancelAttended:t.cancelDecision;
  }else if(stage.decision!=="accepted")help=t.onlyAccepted;
  else if(!hasDeliveryAddress(context.settings,context.liveAvailable?"resend":context.captureAvailable)){state="waiting";label=t.waiting;}
  else if(!context.settings.reminders_enabled){state="off";label=t.off;}
  else if(context.liveAvailable&&row&&delivery){
    const message=delivery;
    state=message.state;label=deliveryLabel(state,lang);
    help=state==="provider_accepted"?d.notice:state==="retry_wait"||state==="quota_wait"?d.retry:"";time=message.accepted_at??row.due_at;
    href=`/my/notifications/${message.id}`+(lang==="en"?"":"?lang="+lang);
  }else if(row?.state==="pending"){state="scheduled";label=t.scheduled;time=row.due_at;help=context.liveAvailable?d.queued:t.queued;}
  else if(row?.state==="captured"){
    state="captured";label=t.captured;const message=context.messages.find((item)=>item.reminder_id===row.id&&item.generation===row.generation);
    time=message?.captured_at??null;href=message?`/my/notifications/${message.id}`+(lang==="en"?"":"?lang="+lang):settingsHref;
  }else if(row?.reason==="dates"){state="dates";label=t.dates;}
  else if(row?.state==="cancelled"){state="cancelled";label=t.cancelled;help=row.reason==="past"?t.cancelPast:"";}
  return `<div class="reminder-status reminder-${state}" data-reminder-state="${state}">${icon(state==="captured"?"mail":"clock")}<div><a href="${html(href)}">${html(label)}</a>${time?`<span>${date(time,lang)}</span>`:""}${help?`<small>${html(help)}</small>`:""}</div></div>`;
}
