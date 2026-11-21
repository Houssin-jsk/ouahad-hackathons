import type { Database } from "../local-d1.ts";
import { publicCatalog } from "../catalog-read.ts";
import type { AuthConfig } from "../private/auth-config.ts";
import { detail, home, messagePage, parseFilters } from "./catalog-page.ts";
import { languageOf } from "./i18n.ts";
import { privateRoutes } from "./private-routes.ts";
import { privateHref } from "./private-page.ts";
import { privateText } from "./private-i18n.ts";
import { findSession } from "../private/session.ts";

export const publicAssets = new Map([
  ["/catalog.css", "text/css; charset=utf-8"], ["/private.css", "text/css; charset=utf-8"],
  ["/icons/logo_black.png", "image/png"], ["/icons/app_icon.png", "image/png"],
  ["/auth/google-g.svg", "image/svg+xml"],
  ["/typography.css", "text/css; charset=utf-8"],
  ["/fonts/inter-variable.ttf", "font/ttf"], ["/fonts/plus-jakarta-sans-variable.ttf", "font/ttf"],
  ["/fonts/ibm-plex-sans-arabic-700.ttf", "font/ttf"],
]);
for (const [family,weights] of [["instrument-serif",[400]],["ibm-plex-sans",[400,500,600]],["noto-naskh-arabic",[400]],["ibm-plex-sans-arabic",[400,500,600]]] as const) {
  for (const weight of weights) publicAssets.set(`/fonts/${family}-${weight}.ttf`,"font/ttf");
}
export type CatalogOptions = { auth: AuthConfig; now?: () => Date; asset?: (request: Request) => Promise<Response> };

export async function catalogHandler(request: Request, db: Database, options: CatalogOptions) {
  const method = request.method, now = options.now ?? (() => new Date());
  let lang = languageOf(null);
  const send = (status: number, body: string, type = "text/html; charset=utf-8", extra: Record<string, string> = {}) =>
    new Response(method === "HEAD" ? null : body, { status, headers: {
      "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...extra,
    } });
  try {
    const url = new URL(request.url), path = url.pathname;
    lang = languageOf(url.searchParams.get("lang"));
    const privateResult = await privateRoutes(db, now, () => options.auth)(request, url);
    if (privateResult) return privateResult;
    if (/^\/(?:my(?:\/|$)|sign-in$|sign-out$|auth\/(?:callback$|email(?:\/|$)))/.test(path)) return send(404, messagePage("notFound", lang));
    if (method !== "GET" && method !== "HEAD") return send(405, "This catalog only supports GET and HEAD.", "text/plain; charset=utf-8", { Allow: "GET, HEAD" });
    if (publicAssets.has(path) && options.asset) return options.asset(request);
    const enabled = options.auth.mode !== "disabled";
    if (path === "/" || path === "/archive") {
      const filters = parseFilters(url.searchParams);
      const entries = await publicCatalog(db, "all", { audience: filters.audience, now: now() });
      return send(200, home(path, entries, filters, entries.filter((entry) => entry.archived).length, enabled ? privateText[lang].my : undefined));
    }
    const encoded = /^\/hackathons\/([^/]+)$/.exec(path)?.[1];
    if (encoded && encoded.length <= 2048) {
      let id: string | undefined;
      try { id = decodeURIComponent(encoded); } catch { /* Invalid encoding. */ }
      if (id) {
        const [entry] = await publicCatalog(db, "all", { id, now: now() });
        if (entry) {
          const signedIn=(options.auth.mode==="demo"||options.auth.mode==="google"||options.auth.mode==="test-provider")
            && Boolean((await findSession(db,request.headers.get("cookie"),now(),options.auth.policy))?.user_id);
          return send(200, detail(entry, {
          filters: parseFilters(url.searchParams), section: url.searchParams.get("from") === "archive" || !url.searchParams.has("from") && entry.archived ? "/archive" : "/",
          privateLink: enabled ? privateText[lang].my : undefined,
          privateSave: enabled ? { label: privateText[lang].save, href: privateHref(signedIn?`/my/save?editionId=${encodeURIComponent(id)}`:`/sign-in?next=${encodeURIComponent(url.pathname+url.search)}`,lang) } : undefined,
        })); }
      }
    }
    return send(404, messagePage("notFound", lang));
  } catch {
    // Do not log URLs, OAuth codes, cookies, tokens or private request bodies.
    console.error("Catalog request failed");
    return send(500, messagePage("unavailable", lang));
  }
}
