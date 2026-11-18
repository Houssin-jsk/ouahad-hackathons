import { deliveryText } from "../email/copy.ts";
import { deliveryStatus, ownerDeliveries, codeDeliveryAvailable } from "../email/queue.ts";
import { dispatchTransactionalEmail } from "../email/service.ts";
import { reconcileUserReminders, reminderMessages, setReminderPreferences, setVerifiedReminderAddress } from "../private/reminders.ts";
import { emailSettingsPage, deliveryCodePage, reminderOutboxPage, liveDeliveryPage } from "./reminder-pages.ts";
import { reminderText } from "../private/reminder-copy.ts";
import { ZodError } from "zod";
import type { Database } from "../local-d1.ts";
import { publicCatalog } from "../catalog-read.ts";
import { addExternal, changeExternalStage, privateEntries, saveCatalog, updateProgress, savePrivateStage, progressValues } from "../private/entries.ts";
import { DateControlError, parseStageForm, stageFormNames } from "../private/stage-form.ts";
import { requestEmailCode, verifyEmailCode, emailChallenge, capturedCode, consumeEmailCode } from "../private/email-codes.ts";
import { cookie, findSession, identities, newSession, validCsrf, type Session } from "../private/session.ts";
import type { AuthConfig } from "../private/auth-config.ts";
import { beginSignIn, callbackPath, clearTransactionCookie, completeSignIn, consumeTransaction, safeReturn } from "../private/oidc.ts";
import { languageOf } from "./i18n.ts";
import { privateText } from "./private-i18n.ts";
import { entryPage, externalPage, myPage, privateHref, privatePage, providerSignInPage, savePage, signInPage, emailStartPage, emailCodePage, outboxPage } from "./private-page.ts";
import { html } from "./catalog-page.ts";
import { agendaText } from "./agenda-i18n.ts";

class RequestError extends Error {
  status: number;
  kind: "invalid" | "csrf" | "notFoundCopy" | "loginRequired";
  constructor(status: number, kind: RequestError["kind"]) { super(kind); this.status = status; this.kind = kind; }
}
async function form(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") throw new RequestError(400, "invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) throw new RequestError(413, "invalid");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const data = new URLSearchParams(new TextDecoder().decode(body));
  if ([...data.keys()].some((key) => data.getAll(key).length !== 1)) throw new RequestError(400, "invalid");
  return data;
}
function only(data: URLSearchParams, names: string[]) {
  if ([...data.keys()].some((key) => !["csrf", ...names].includes(key))) throw new RequestError(400, "invalid");
}
const stageNames = stageFormNames;
const stageData = parseStageForm;

export function privateRoutes(db: Database, now: () => Date, getConfig: () => AuthConfig) {
  return async (request: Request, url = new URL(request.url)): Promise<Response | null> => {
    const path = url.pathname;
    let lang = languageOf(url.searchParams.get("lang")), t = privateText[lang];
    if (!/^\/(?:my(?:\/|$)|sign-in$|sign-out$|auth\/(?:callback$|email(?:\/|$)))/.test(path)) return null;
    const config = getConfig();
    if (config.mode === "disabled") return null;
    const headers = new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": path === callbackPath ? "no-referrer" : "same-origin",
      "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff" });
    if (path === "/sign-in" && (config.mode === "google" || config.mode === "test-provider")) {
      // Browsers enforce form-action on POST redirects too. Permit only this configured provider.
      headers.set("Content-Security-Policy", `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' ${new URL(config.issuer).origin}; base-uri 'none'; frame-ancestors 'none'`);
    }
    const method = request.method ?? "GET";
    let response: Response | null = null;
    let session: Session | null = null;
    const send = (status: number, body: string) => {
      headers.set("Content-Type", "text/html; charset=utf-8");
      response = new Response(method === "HEAD" ? null : body, { status, headers });
    };
    const redirect = (path: string) => { headers.set("Location", privateHref(path, lang)); response = new Response(null, { status: 303, headers }); };
    const errorPage = (title: string, text: string, next?: string) => {
      const retry = next ? privateHref(`/sign-in?next=${encodeURIComponent(next)}`, lang) : null;
      return privatePage(title, `<p>${html(text)}</p>${retry ? `<a href="${html(retry)}">${html(t.signin)}</a>` : ""}`,
        lang, retry ?? url.pathname, null, config.mode === "demo" ? "demo" : "provider");
    };
    if (config.mode === "unavailable") { send(503, errorPage(t.signin, t.authUnavailable)); return response; }
    try {
      const trusted = new URL(config.origin);
      const allowedOrigins = config.mode === "demo" ? [trusted.origin, `http://localhost:${trusted.port}`] : [trusted.origin];
      if (!allowedOrigins.includes(url.origin)) throw new RequestError(403, "csrf");
      if (!["GET", "HEAD", "POST"].includes(method)) { headers.set("Allow", "GET, HEAD, POST"); throw new RequestError(405, "invalid"); }
      session = await findSession(db, request.headers.get("cookie"), now(), config.policy);
      if (path === callbackPath) {
        if (config.mode === "demo" || method !== "GET") throw new RequestError(404, "notFoundCopy");
        if (!session) throw new RequestError(403, "csrf");
        const transaction = await consumeTransaction(db, config, request, session, now());
        if (!transaction) throw new RequestError(403, "csrf");
        lang = languageOf(new URL(transaction.return_path, config.origin).searchParams.get("lang")); t = privateText[lang];
        headers.append("Set-Cookie", clearTransactionCookie(config));
        try {
          const created = await completeSignIn(db, config, request, transaction, session, now());
          headers.append("Set-Cookie", created.setCookie);
          redirect(transaction.return_path);
        } catch { send(400, errorPage(t.signin, t.authFailed, transaction.return_path)); }
        return response;
      }
      let data: URLSearchParams | undefined;
      if (method === "POST") {
        if (!session) throw new RequestError(401, "loginRequired");
        if (request.headers.get("origin") !== url.origin) throw new RequestError(403, "csrf");
        data = await form(request);
        if (!validCsrf(session, data.get("csrf") ?? "")) throw new RequestError(403, "csrf");
      }
      if (path === "/auth/email" || path.startsWith("/auth/email/")) {
        if (config.mode === "demo" || !config.emailLive && (!config.emailCapture || config.policy.secure)) throw new RequestError(404,"notFoundCopy");
        if (!session) {
          const created=await newSession(db,null,now(),null,config.policy);
          session=created.session;headers.append("Set-Cookie",created.setCookie);
        }
        const next=safeReturn(url.searchParams.get("next"),lang),a=agendaText[lang];
        const challengeFor=(id:string,context=false)=>emailChallenge(db,session!,id,now(),context,"signin",config.emailLive?"resend":"capture");
        const stateFor=async(id:string)=>{if(!config.emailLive)return undefined;const job=await db.prepare("SELECT id FROM email_deliveries WHERE challenge_id=? AND kind='signin'").bind(id).first<string>("id");if(!job)return "failed";await dispatchTransactionalEmail(db,config.emailLive,job,{now:now()});return (await deliveryStatus(db,job))?.state??"failed";};
        if(path==="/auth/email"&&method!=="POST")send(200,emailStartPage(lang,next,session));
        else if(path==="/auth/email/start"&&method==="POST"){
          only(data!,["email","next"]);
          if(config.emailLive&&!await codeDeliveryAvailable(db,now())){send(503,emailStartPage(lang,next,session,deliveryText[lang].failed));return response;}
          try{
            const requested=await requestEmailCode(db,config,session,data!.get("email")??"",safeReturn(data!.get("next"),lang),now(),"signin",lang);
            if(requested.status==="limited")send(429,emailStartPage(lang,safeReturn(data!.get("next"),lang),session,a.limited));
            else redirect(`/auth/email/code?challenge=${requested.id}`);
          }catch(error){if(error instanceof ZodError)send(400,emailStartPage(lang,safeReturn(data!.get("next"),lang),session,t.invalid));else throw error;}
        }else if(path==="/auth/email/code"&&method!=="POST"){
          const challenge=await challengeFor(url.searchParams.get("challenge")??"");
          if(!challenge){const context=await challengeFor(url.searchParams.get("challenge")??"",true);send(400,emailStartPage(lang,context?.return_path??next,session,a.codeInvalid));}else send(200,emailCodePage(lang,challenge,session,false,await stateFor(challenge.id)));
        }else if(path==="/auth/email/outbox"&&method!=="POST"){
          if(config.emailLive)throw new RequestError(404,"notFoundCopy");
          const id=url.searchParams.get("challenge")??"",message=await capturedCode(db,session,id,now());
          if(!message)throw new RequestError(404,"notFoundCopy");send(200,outboxPage(lang,id,message,session));
        }else if(path==="/auth/email/verify"&&method==="POST"){
          only(data!,["challenge","code"]);
          const id=data!.get("challenge")??"",verified=await verifyEmailCode(db,config,session,id,data!.get("code")??"",now());
          if(verified){headers.append("Set-Cookie",verified.setCookie);redirect(safeReturn(verified.next,lang));}
          else{const challenge=await challengeFor(id),context=challenge??await challengeFor(id,true);send(400,challenge?emailCodePage(lang,challenge,session,true,await stateFor(id)):emailStartPage(lang,context?.return_path??next,session,a.codeInvalid));}
        }else throw new RequestError(404,"notFoundCopy");
        return response;
      }
      if (path === "/sign-in") {
        if (method === "POST") {
          only(data!, config.mode === "demo" ? ["identity", "next"] : ["next"]);
          if (config.mode === "demo") {
            const identity = identities.find((item) => item.id === data!.get("identity"));
            if (!identity) throw new RequestError(400, "invalid");
            const created = await newSession(db, identity.id, now(), session, config.policy);
            headers.append("Set-Cookie", created.setCookie);
            redirect(safeReturn(data!.get("next"), lang));
          } else {
            try {
              const started = await beginSignIn(db, config, session!, safeReturn(data!.get("next"), lang), now());
              headers.append("Set-Cookie", started.setCookie);
              headers.set("Location", started.location);
              response = new Response(null, { status: 303, headers });
            } catch { send(503, errorPage(t.signin, t.authFailed, safeReturn(data!.get("next"), lang))); }
          }
        } else {
          if (!session) {
            const created = await newSession(db, null, now(), null, config.policy);
            headers.append("Set-Cookie", created.setCookie);
            session = created.session;
          }
          const next = safeReturn(url.searchParams.get("next"), lang);
          send(200, config.mode === "demo" ? signInPage(lang, next, session) : providerSignInPage(lang, next, session, config.mode, Boolean(config.emailCapture||config.emailLive&&await codeDeliveryAvailable(db,now()))));
        }
        return response;
      }
      if (!session?.user_id) {
        if (method === "POST") throw new RequestError(401, "loginRequired");
        redirect(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
        return response;
      }
      const user = session.user_id;
      const captureAvailable:boolean|"resend" = config.mode!=="demo"&&config.emailLive?"resend":config.mode !== "demo" && Boolean(config.emailCapture) && !config.policy.secure;
      if(path === "/my/email-settings" || path.startsWith("/my/email-settings/") || path === "/my/notifications" || path.startsWith("/my/notifications/")) {
        const r=reminderText[lang];
        const context=()=>reconcileUserReminders(db,user,now(),captureAvailable,lang);
        if(path === "/my/email-settings" && method !== "POST")send(200,emailSettingsPage(await context(),session,lang,url.searchParams.has("verified")?r.addressVerified:url.searchParams.has("saved")?r.saved:undefined));
        else if(path === "/my/email-settings" && method === "POST"){
          only(data!,["enabled","language"]);
          const language=data!.get("language"),enabled=data!.get("enabled");
          if(!["en","fr","ar"].includes(language??"") || enabled!==null&&enabled!=="1")throw new RequestError(400,"invalid");
          if(!await setReminderPreferences(db,user,enabled==="1",language as typeof lang,captureAvailable,now()))send(400,emailSettingsPage(await context(),session,lang,r.missing));
          else {await context();redirect("/my/email-settings?saved=1");}
        }else if(path === "/my/email-settings/address" && method === "POST"){
          only(data!,["email"]);
          if(config.mode === "demo" || !captureAvailable)throw new RequestError(404,"notFoundCopy");
          try{
            const requested=await requestEmailCode(db,config,session,data!.get("email")??"","/my/email-settings",now(),"reminder-address",lang);
            if(requested.status==="limited")send(429,emailSettingsPage(await context(),session,lang,r.limited));
            else redirect("/my/email-settings/code?challenge="+requested.id);
          }catch(error){if(error instanceof ZodError)send(400,emailSettingsPage(await context(),session,lang,t.invalid));else throw error;}
        }else if(["/my/email-settings/code","/my/email-settings/code-outbox"].includes(path)&&method!=="POST"){
          if(!captureAvailable||captureAvailable==="resend"&&path.endsWith("code-outbox"))throw new RequestError(404,"notFoundCopy");
          const id=url.searchParams.get("challenge")??"",challenge=await emailChallenge(db,session,id,now(),false,"reminder-address",captureAvailable==="resend"?"resend":"capture");
          if(!challenge)throw new RequestError(404,"notFoundCopy");
          const message=path.endsWith("code-outbox")?await capturedCode(db,session,id,now(),"reminder-address"):null;
          let state:string|undefined;
          if(config.mode!=="demo"&&config.emailLive){const job=await db.prepare("SELECT id FROM email_deliveries WHERE challenge_id=? AND user_id=? AND kind='reminder-address'").bind(id,user).first<string>("id");if(job){await dispatchTransactionalEmail(db,config.emailLive,job,{now:now()});state=(await deliveryStatus(db,job))?.state??"failed";}else state="failed";}
          send(200,deliveryCodePage(challenge,session,lang,false,message?.code,state));
        }else if(path === "/my/email-settings/verify"&&method==="POST"){
          only(data!,["challenge","code"]);
          if(config.mode === "demo" || !captureAvailable)throw new RequestError(404,"notFoundCopy");
          const id=data!.get("challenge")??"",verified=await consumeEmailCode(db,config,session,id,data!.get("code")??"",now(),"reminder-address");
          if(verified){await setVerifiedReminderAddress(db,user,verified.email,now(),config.emailLive?"resend":"capture");await context();redirect("/my/email-settings?verified=1");}
          else{const challenge=await emailChallenge(db,session,id,now(),false,"reminder-address",captureAvailable==="resend"?"resend":"capture");if(challenge)send(400,deliveryCodePage(challenge,session,lang,true,undefined,config.emailLive?"retry_wait":undefined));else send(400,emailSettingsPage(await context(),session,lang,r.codeFailed));}
        }else if(method!=="POST"&&/^\/my\/notifications(?:\/[a-f0-9]{64})?$/.test(path)){
          const id=path.split("/")[3];
          if(captureAvailable==="resend"){const deliveries=(await ownerDeliveries(db,user)).filter((item)=>!id||item.id===id);if(id&&!deliveries.length)throw new RequestError(404,"notFoundCopy");send(200,liveDeliveryPage(deliveries,session,lang));return response;}
          const messages=await reminderMessages(db,user,id);
          if(id&&!messages.length)throw new RequestError(404,"notFoundCopy");
          send(200,reminderOutboxPage(messages,session,lang,Boolean(id)));
        }else throw new RequestError(404,"notFoundCopy");
        return response;
      }
      if (path === "/sign-out" && method === "POST") {
        only(data!, ["next"]);
        await db.prepare("DELETE FROM private_sessions WHERE token_hash = ?").bind(session.token_hash).run();
        headers.append("Set-Cookie", cookie("", config.policy, 0));
        if (config.mode !== "demo") headers.append("Set-Cookie", clearTransactionCookie(config));
        redirect(safeReturn(data!.get("next") ?? "/", lang));
      } else if (path === "/my" && method !== "POST") {
        send(200, myPage(await privateEntries(db, user, now()), session, lang, now(), url.searchParams.get("view")??"",await reconcileUserReminders(db,user,now(),captureAvailable,lang)));
      } else if (path === "/my/new") {
        if (method === "POST") {
          only(data!, ["title", "domain", "eventUrl", ...stageNames]);
          const id = await addExternal(db, user, {
            title: data!.get("title"), domain: data!.get("domain"), eventUrl: data!.get("eventUrl") || null, stage: stageData(data!),
          }, now());
          redirect(`/my/entries/${id}`);
        } else send(200, externalPage(session, lang));
      } else if (path === "/my/save") {
        if (method === "POST") only(data!, ["editionId"]);
        const id = method === "POST" ? data!.get("editionId") : url.searchParams.get("editionId");
        const listing = id ? (await publicCatalog(db, "all", { id, now: now() }))[0] : null;
        if (!listing) throw new RequestError(404, "notFoundCopy");
        if (method === "POST") {
          const saved = await saveCatalog(db, user, listing.id, now());
          if (!saved) throw new RequestError(404, "notFoundCopy");
          redirect(`/my/entries/${saved}`);
        } else send(200, savePage(listing.id, listing.title, session, lang));
      } else {
        const route = /^\/my\/entries\/([\w-]+)(?:\/(progress|stages)(?:\/([\w-]+))?(\/save)?)?$/.exec(path);
        const id = route?.[1], action = route?.[2], key = route?.[3];
        const [entry] = id ? await privateEntries(db, user, now(), id) : [];
        if (!entry) throw new RequestError(404, "notFoundCopy");
        if (!action && method !== "POST") {
          send(200, entryPage(entry, await privateEntries(db, user, now()), session, lang, url.searchParams.get("view")??"",url.searchParams.get("saved")??"",await reconcileUserReminders(db,user,now(),captureAvailable,lang)));
        } else if(action === "stages" && key && route?.[4] && method === "POST") {
          only(data!,["version",...Object.keys(progressValues),...(entry.catalogId?[]:stageNames)]);
          const previous=entry.stages.find((stage)=>stage.key===key);
          if(!previous)throw new RequestError(404,"notFoundCopy");
          const state=Object.fromEntries(Object.keys(progressValues).map((field)=>[field,data!.get(field)]));
          const result=await savePrivateStage(db,user,id!,key,data!.get("version")??"",state,entry.catalogId?undefined:stageData(data!,previous),now());
          if(result==="missing")throw new RequestError(404,"notFoundCopy");
          if(result==="stale")send(409,privatePage(t.error,`<p>${html(agendaText[lang].stale)}</p><a class="btn btn-secondary" href="${privateHref(`/my/entries/${id}`,lang)}">${html(t.back)}</a>`,lang,`/my/entries/${id}`,session));
          else redirect(`/my/entries/${id}?saved=${key}${url.searchParams.get("view")?'&view='+encodeURIComponent(url.searchParams.get("view")!):''}#stage-${key}`);
        } else if (action === "progress" && !key && method === "POST") {
          only(data!, ["stage", "field", "value"]);
          if (!await updateProgress(db, user, id!, data!.get("stage") ?? "", data!.get("field") ?? "", data!.get("value") ?? "", now())) throw new RequestError(404, "notFoundCopy");
          redirect(`/my/entries/${id}`);
        } else if (action === "stages" && method === "POST") {
          only(data!, stageNames);
          if (!await changeExternalStage(db, user, id!, stageData(data!,entry.stages.find((stage)=>stage.key===key)), key)) throw new RequestError(404, "notFoundCopy");
          redirect(`/my/entries/${id}`);
        } else throw new RequestError(404, "notFoundCopy");
      }
    } catch (error) {
      if(error instanceof DateControlError){send(400,errorPage(t.error,agendaText[lang].invalidDate));return response;}
      if (!(error instanceof RequestError) && !(error instanceof ZodError)) {
        // Validation errors from domain operations contain no private values in the response.
        if (!(error instanceof Error && /prerequisite|first stage|tracking value|Prerequisite/.test(error.message))) {
          console.error("Private request failed");
          send(500, errorPage(t.error, t.invalid));
          return response;
        }
      }
      const status = error instanceof RequestError ? error.status : 400;
      const kind = error instanceof RequestError ? error.kind : "invalid";
      send(status, errorPage(status === 404 ? t.notFound : t.error, t[kind]));
    }
    return response;
  };
}
