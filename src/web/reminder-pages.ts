import { html, published, date } from "./catalog-page.ts";
import { privateHref, privatePage } from "./private-page.ts";
import { icon } from "./private-icons.ts";
import { reminderText } from "../private/reminder-copy.ts";
import { hasDeliveryAddress, type ReminderContext, type ReminderMessage } from "../private/reminders.ts";
import type { Session } from "../private/session.ts";
import type { Language } from "./i18n.ts";
import { deliveryText, deliveryLabel } from "../email/copy.ts";
import type { Delivery } from "../email/queue.ts";
const hidden=(key:string,value:string)=>`<input type="hidden" name="${key}" value="${html(value)}">`;
const csrf=(session:Session)=>hidden("csrf",session.csrf);
export function emailSettingsPage(context:ReminderContext,session:Session,lang:Language,notice?:string){
  const t=reminderText[lang],d=deliveryText[lang],settings=context.settings,verified=hasDeliveryAddress(settings,context.liveAvailable?"resend":context.captureAvailable);
  return privatePage(t.settings,`<div class="entry-intro"><a class="ordinary-link" href="${privateHref('/my',lang)}">${html(t.back)}</a></div>
    ${notice?`<p class="save-notice" role="status">${icon('check')}${html(notice)}</p>`:''}
    <div class="email-settings-grid"><section class="editor-surface"><h2>${html(t.reminders)}</h2><p>${html(t.intro)}</p>
      ${verified?`<p><strong>${html(t.verified)}</strong><br>${published(settings.delivery_email!)}</p><p class="help">${html(context.liveAvailable?d.verified:t.localProof)}</p>`:`<p class="notice">${html(t.missing)}</p>`}
      <form class="private-form" method="post" action="${privateHref('/my/email-settings',lang)}">${csrf(session)}
      <label class="check"><input type="checkbox" name="enabled" value="1"${settings.reminders_enabled&&verified?' checked':''}${!verified?' disabled':''}>${html(t.enable)}</label>
      <label>${html(t.language)}<select name="language" aria-label="${html(t.language)}">${[['en','English'],['fr','Français'],['ar','العربية']].map(([value,label])=>`<option value="${value}"${value===settings.language?' selected':''}>${label}</option>`).join('')}</select></label>
      <button class="btn btn-primary">${icon('check')}${html(t.save)}</button></form><p class="help">${html(t.timing)}</p><p class="local-notice">${html(context.liveAvailable?(context.ownerOnly?d.ownerOnly:d.live):context.captureAvailable?t.local:t.unavailable)}</p>
      ${context.liveAvailable||context.captureAvailable?`<a class="ordinary-link" href="${privateHref('/my/notifications',lang)}">${icon('mail')}${html(context.liveAvailable?d.history:t.notifications)}</a>`:''}</section>
      <section class="editor-surface"><h2>${html(t.verify)}</h2><p class="help">${html(t.verifyHelp)}</p>
      ${context.captureAvailable||context.liveAvailable?`<form class="private-form" method="post" action="${privateHref('/my/email-settings/address',lang)}">${csrf(session)}<label>${html(t.address)}<input name="email" type="email" required maxlength="254" dir="ltr" autocomplete="email"></label><button class="btn btn-secondary">${icon('mail')}${html(t.verify)}</button></form>`:`<p>${html(t.unavailable)}</p>`}</section></div>`,lang,'/my/email-settings',session);
}
export function deliveryCodePage(challenge:{id:string;email:string},session:Session,lang:Language,error=false,code?:string,deliveryState?:string){
  const t=reminderText[lang],d=deliveryText[lang];
  return privatePage(t.codeTitle,`<section class="outbox-card"><p>${published(challenge.email)}</p><p class="help">${html(t.verifyHelp)}</p><p class="local-notice">${html(deliveryState===undefined?t.local:deliveryLabel(deliveryState,lang))}</p>${deliveryState!==undefined?`<p class="help">${html(d.notice)}</p>`:''}
    ${code?`<p class="captured-code" dir="ltr">${html(code)}</p>`:''}${error?`<p class="form-error" role="alert">${html(t.codeFailed)}</p>`:''}
    <form class="private-form" method="post" action="${privateHref('/my/email-settings/verify',lang)}">${csrf(session)}${hidden('challenge',challenge.id)}
    <label>${html(t.code)}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required dir="ltr"></label><button class="btn btn-primary">${html(t.verifyCode)}</button></form>
    ${!code&&deliveryState===undefined?`<a class="btn btn-secondary" href="${privateHref('/my/email-settings/code-outbox?challenge='+challenge.id,lang)}">${icon('mail')}${html(t.outboxCode)}</a>`:''}
    <p><a class="ordinary-link" href="${privateHref('/my/email-settings',lang)}">${html(t.settings)}</a></p></section>`,lang,`/my/email-settings/${code?'code-outbox':'code'}?challenge=${challenge.id}`,session);
}
export function liveDeliveryPage(deliveries:Delivery[],session:Session,lang:Language){const d=deliveryText[lang],t=reminderText[lang];return privatePage(d.history,`<p>${html(d.notice)}</p><ul class="notification-list">${deliveries.map((item)=>`<li class="editor-surface"><p>${html(deliveryLabel(item.state,lang))}</p>${item.accepted_at?date(item.accepted_at,lang):''}</li>`).join('')}</ul>${!deliveries.length?`<p>${html(t.empty)}</p>`:''}`,lang,'/my/notifications',session);}
export function reminderOutboxPage(messages:ReminderMessage[],session:Session,lang:Language,detail=false){
  const t=reminderText[lang];
  return privatePage(t.notifications,`<div class="entry-intro"><a class="ordinary-link" href="${privateHref('/my/email-settings',lang)}">${html(t.settings)}</a></div><p class="local-notice">${html(t.outboxHelp)}</p>
    ${messages.length?`<ul class="notification-list">${messages.map((message)=>`<li class="editor-surface"><p class="kicker">${html(t.captured)}</p><h2><a href="${privateHref('/my/notifications/'+message.id,lang)}">${published(message.subject)}</a></h2><p>${html(t.recipient)}: ${published(message.recipient)}</p><p>${html(t.capturedAt)}: ${date(message.captured_at,lang)}</p>${detail?`<pre class="reminder-message" dir="${message.language==='ar'?'rtl':'ltr'}">${html(message.body)}</pre>`:''}</li>`).join('')}</ul>`:`<p class="empty-filter">${html(t.empty)}</p>`}`,lang,'/my/notifications'+(detail&&messages[0]?'/'+messages[0].id:''),session);
}
