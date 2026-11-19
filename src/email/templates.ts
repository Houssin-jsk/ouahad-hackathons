import { reminderDate, reminderText, type ReminderLanguage } from "../private/reminder-copy.ts";

const copy = {
  en: { private: "YOUR PERSONAL AGENDA", verification: "Verify your delivery address", code: "Your verification code", help: "Enter this code in the Ouahad Hackathons page where you requested it.", footer: "Your opportunities. Your next step.", start: "Starts", end: "Ends", unknown: "Date not yet known", updated: "Updated schedule", view: "View your stage", settings: "Reminder settings", privacy: "This opportunity is in your private agenda." },
  fr: { private: "VOTRE AGENDA PERSONNEL", verification: "Vérifiez votre adresse de livraison", code: "Votre code de vérification", help: "Saisissez ce code sur la page Ouahad Hackathons où vous l’avez demandé.", footer: "Vos opportunités. Votre prochaine étape.", start: "Début", end: "Fin", unknown: "Date encore inconnue", updated: "Calendrier mis à jour", view: "Voir votre étape", settings: "Paramètres des rappels", privacy: "Cette opportunité figure dans votre agenda privé." },
  ar: { private: "أجندتك الشخصية", verification: "تحقق من عنوان التسليم", code: "رمز التحقق الخاص بك", help: "أدخل هذا الرمز في صفحة Ouahad Hackathons التي طلبته منها.", footer: "فرصك. خطوتك القادمة.", start: "البداية", end: "النهاية", unknown: "التاريخ غير معروف بعد", updated: "الجدول المحدّث", view: "عرض مرحلتك", settings: "إعدادات التذكيرات", privacy: "هذه الفرصة في أجندتك الخاصة." },
};

// All interpolated text and attributes pass through this boundary. No source HTML is accepted.
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function href(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid email link");
  return escape(url.href);
}
const ink = "#10212B", line = "#DDDCD4", muted = "#46565D";
const bodyFont = "Arial, Tahoma, sans-serif";
const editorial = "Georgia, 'Times New Roman', serif";
const paragraph = (text: string) => `<p style="margin:0 0 20px;font:16px/1.65 ${bodyFont};color:${muted};">${escape(text)}</p>`;
const source = (text: string) => `<span dir="auto" style="unicode-bidi:isolate;overflow-wrap:anywhere;word-break:break-word;">${escape(text)}</span>`;

function layout(lang: ReminderLanguage, title: string, preheader: string, content: string) {
  const rtl = lang === "ar", dir = rtl ? "rtl" : "ltr", align = rtl ? "right" : "left";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title></head>
<body dir="${dir}" style="margin:0;padding:0;width:100%;background-color:#F7F5EF;color:${ink};-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;color:#F7F5EF;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F7F5EF" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" dir="${dir}" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;text-align:${align};">
<tr><td style="padding:0 8px 20px;">
<table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" border="0"><tr><td width="48" valign="middle"><img src="https://hackathons.ouahad.space/icons/logo_black.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;"></td><td valign="middle"><p dir="ltr" style="margin:0;font:11px/1.4 ${editorial};letter-spacing:1.6px;color:${ink};">OUAHAD SPACE</p><p dir="ltr" style="margin:2px 0 0;font:italic 22px/1.2 ${editorial};color:#077F64;">Hackathons</p></td></tr></table>
</td></tr>
<tr><td bgcolor="#FFFDF8" style="background-color:#FFFDF8;border:1px solid ${line};border-top:3px solid #3590DF;padding:28px 24px;">
<p style="margin:0 0 24px;font:11px/1.6 ${bodyFont};letter-spacing:${rtl ? "0" : "1.8px"};color:${muted};">${escape(copy[lang].private)}</p>
${content}
</td></tr>
<tr><td style="padding:22px 8px 0;"><p style="margin:0;font:italic 17px/1.6 ${editorial};color:${ink};">${escape(copy[lang].footer)}</p><p dir="ltr" style="margin:6px 0 0;font:11px/1.6 ${bodyFont};letter-spacing:1px;color:${muted};">OUAHAD SPACE / HACKATHONS</p></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

export function verificationHtml(code: string, expires: string, lang: ReminderLanguage) {
  const t = copy[lang];
  return layout(lang, t.verification, t.verification, `<h1 style="margin:0 0 18px;font:normal 32px/1.2 ${editorial};color:${ink};">${escape(t.verification)}</h1>
${paragraph(t.help)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:28px 0 18px;"><tr><td align="center" bgcolor="#F7F5EF" style="background-color:#F7F5EF;border:1px solid ${line};padding:22px 8px;">
<p style="margin:0 0 10px;font:12px/1.5 ${bodyFont};color:${muted};">${escape(t.code)}</p>
<p dir="ltr" style="margin:0;font:bold 38px/1.3 'Courier New',monospace;letter-spacing:5px;text-align:center;direction:ltr;unicode-bidi:isolate;color:${ink};">${escape(code)}</p>
</td></tr></table>
<p style="margin:0;border-top:2px solid #F3A339;padding-top:16px;font:14px/1.7 ${bodyFont};color:${muted};">${escape(expires)}</p>`);
}

export type ReminderPresentation = {
  language: ReminderLanguage; title: string; stage: string; start: string | null; end: string | null;
  changed: boolean; notice: string; stageUrl: string; settingsUrl: string;
};

export function reminderHtml(p: ReminderPresentation) {
  const lang = p.language, t = copy[lang], r = reminderText[lang], rtl = lang === "ar";
  const date = (value: string | null) => value ? reminderDate(value, lang) : t.unknown;
  const dates = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:24px 0;"><tr><td style="border-${rtl ? "right" : "left"}:3px solid #F3A339;padding:4px 16px;">
<p style="margin:0 0 6px;font:12px/1.5 ${bodyFont};color:${muted};">${escape(t.start)}</p>
<p style="margin:0;font:bold 19px/1.55 ${bodyFont};color:${ink};">${source(date(p.start))}</p>
${p.start && !p.start.includes("T") ? `<p style="margin:8px 0 0;font:14px/1.6 ${bodyFont};color:${muted};">${escape(r.dateLabel)}</p>` : ""}
${p.end && p.end !== p.start ? `<p style="margin:16px 0 4px;font:12px/1.5 ${bodyFont};color:${muted};">${escape(t.end)}</p><p style="margin:0;font:16px/1.6 ${bodyFont};color:${ink};">${source(date(p.end))}</p>` : ""}
</td></tr></table>`;
  return layout(lang, p.changed ? r.changeSubject : r.subject, `${p.title} — ${p.stage}`, `
<p style="margin:0 0 12px;font:12px/1.5 ${bodyFont};color:#077F64;">${escape(p.changed ? r.changeSubject : r.subject)}</p>
<h1 style="margin:0 0 14px;font:normal 32px/1.2 ${editorial};color:${ink};">${source(p.title)}</h1>
<p style="margin:0 0 24px;font:20px/1.45 ${bodyFont};color:${ink};">${source(p.stage)}</p>
${paragraph(p.notice)}
${p.changed ? `<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid ${line};font:bold 14px/1.6 ${bodyFont};color:${ink};">${escape(t.updated)}</p>` : ""}
${dates}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td align="center" bgcolor="#077F64" style="background-color:#077F64;border:1px solid #077F64;border-radius:4px;mso-padding-alt:14px 22px;">
<a href="${href(p.stageUrl)}" style="display:inline-block;padding:14px 22px;font:bold 16px/1.5 ${bodyFont};color:#FFFFFF;text-decoration:none;text-align:center;mso-padding-alt:0;">${escape(t.view)}</a>
</td></tr></table>
<p style="margin:18px 0 24px;font:14px/1.6 ${bodyFont};"><a href="${href(p.settingsUrl)}" style="color:#077F64;text-decoration:underline;">${escape(t.settings)}</a></p>
<p style="margin:0;padding-top:18px;border-top:1px solid ${line};font:13px/1.6 ${bodyFont};color:${muted};">${escape(t.privacy)}</p>`);
}
