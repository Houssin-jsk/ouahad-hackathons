import { audiences } from "../catalog-read.ts";
import type { Audience, PublicListing } from "../catalog-read.ts";
import { languageOf, languages, locale, messages } from "./i18n.ts";
import type { Language } from "./i18n.ts";

type Stage = PublicListing["stages"][number];
export type Section = "/" | "/archive";

const labels = (lang: Language) => ({ morocco: messages[lang].morocco, "international-online": messages[lang].international });
const formats = (lang: Language): Record<Stage["format"], string> => ({
  "in-person": messages[lang].inPerson, online: messages[lang].online,
  hybrid: messages[lang].hybrid, unknown: messages[lang].unknownFormat,
});
const statuses = (lang: Language) => ({
  open: messages[lang].open, unknown: messages[lang].unknown,
  "applications-closed": messages[lang].closed, finished: messages[lang].finished,
  eligibility: messages[lang].eligibility,
});
type FilterStatus = keyof ReturnType<typeof statuses>;

export type Filters = {
  lang: Language;
  audience?: Audience;
  q: string;
  field: string;
  city: string;
  format: string;
  status: FilterStatus | "";
};

export function parseFilters(query: URLSearchParams): Filters {
  const get = (key: string) => (query.get(key) ?? "").trim().slice(0, 120);
  const status = get("status");
  return {
    lang: languageOf(query.get("lang")),
    audience: audiences.find((audience) => audience === get("audience")),
    q: get("q"), field: get("field"), city: get("city"), format: get("format"),
    status: Object.hasOwn(statuses("en"), status) ? status as FilterStatus : "",
  };
}

const lc = (value: string) => value.normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase();
function audienceStages(entry: PublicListing, audience?: Audience) {
  return entry.stages.filter((stage) => {
    if (!audience) return true;
    if (audience === "morocco") return stage.category === "morocco";
    return (stage.category === "international-online" || stage.onlineFromMorocco)
      && stage.moroccoEligibility.status === "confirmed";
  });
}
const filterKeys = ["q", "field", "city", "format", "status"] as const;
export function location(section: Section, value: Partial<Filters> = {}) {
  const query = new URLSearchParams();
  if (value.lang && value.lang !== "en") query.set("lang", value.lang);
  if (value.audience) query.set("audience", value.audience);
  for (const key of filterKeys) {
    if (value[key]) query.set(key, value[key]);
  }
  return section + (query.size ? `?${query}` : "");
}

function filterStatus(entry: PublicListing): FilterStatus {
  if (entry.confirmedOpen) return "open";
  return entry.status === "open" ? "eligibility" : entry.status;
}

export function filterCatalog(entries: PublicListing[], filters: Filters, section: Section) {
  const inSection = entries.filter(({ archived }) => archived === (section === "/archive"));
  const keywords = lc(filters.q).split(/\s+/).filter(Boolean);
  const matching = inSection.filter((entry) => {
    const stages = audienceStages(entry, filters.audience);
    const searchable = lc([entry.title, entry.organizer, ...entry.topics, ...stages.map((stage) => stage.city)].join(" "));
    return keywords.every((term) => searchable.includes(term))
      && (!filters.field || entry.topics.some((topic) => lc(topic) === lc(filters.field)))
      && (!filters.status || filterStatus(entry) === filters.status)
      && stages.some((stage) => (!filters.city || (stage.city && lc(stage.city) === lc(filters.city)))
        && (!filters.format || stage.format === filters.format));
  });
  const time = (entry: PublicListing, mode: "eventStart" | "eventEnd") => {
    const dates = audienceStages(entry, filters.audience).map((stage) => stage[mode])
      .filter((date): date is string => date !== null).map((date) => Date.parse(date));
    return mode === "eventStart" ? Math.min(Infinity, ...dates) : Math.max(-Infinity, ...dates);
  };
  return {
    inSection,
    matching: matching.sort((a, b) => {
      if (section === "/archive") return (time(b, "eventEnd") - time(a, "eventEnd")) || a.title.localeCompare(b.title);
      return Number(b.confirmedOpen) - Number(a.confirmedOpen)
        || (time(a, "eventStart") - time(b, "eventStart")) || a.title.localeCompare(b.title);
    }),
  };
}

export const html = (value: string | number) => String(value).replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export const published = (value: string) => `<bdi dir="auto">${html(value)}</bdi>`;
const arrow = '<span class="arrow" aria-hidden="true">→</span>';
const externalArrow = '<span aria-hidden="true">↗</span>';
export const listingPath = (id: string) => `/hackathons/${encodeURIComponent(id)}`;
const unknown = (lang: Language) => `<span class="unpublished">${messages[lang].unpublished}</span>`;
const keyLabels = (lang: Language) => ({
  q: messages[lang].search, field: messages[lang].field, city: messages[lang].city,
  format: messages[lang].format, status: messages[lang].registration,
});
function dateFormat(lang: Language, exact = false, seconds = false) {
  return new Intl.DateTimeFormat(locale[lang], {
    day: "numeric", month: "short", year: "numeric",
    ...(exact ? { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}),
      hourCycle: "h23", timeZone: "Africa/Casablanca" } : { timeZone: "UTC" }),
  });
}
export function date(value: string, lang: Language) {
  const parsed = new Date(value), exact = value.includes("T");
  return `<time datetime="${html(value)}"><bdi>${html(dateFormat(lang, exact, Boolean(parsed.getUTCSeconds())).format(parsed))}</bdi></time>${
    exact ? ` <span class="timezone">${messages[lang].moroccoTime}</span>` : ""}`;
}
export function eventDates(start: string | null, end: string | null, lang: Language) {
  if (!start && !end) return unknown(lang);
  if (!start) return `${messages[lang].ends} ${date(end!, lang)}`;
  if (!end) return `${messages[lang].starts} ${date(start, lang)}`;
  if (start === end) return date(start, lang);
  if (!start.includes("T") && !end.includes("T")) {
    return `<bdi>${html(dateFormat(lang).formatRange(new Date(start), new Date(end)))}</bdi>`;
  }
  return `${date(start, lang)} <span aria-hidden="true">—</span> ${date(end, lang)}`;
}
function statusBadge(entry: PublicListing, lang: Language) {
  const status = filterStatus(entry);
  return `<span class="badge badge--${status}">${status === "eligibility" ? messages[lang].checkEligibility : statuses(lang)[status]}</span>`;
}
function searchIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/></svg>';
}
function filterIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></svg>';
}
function topics(entry: PublicListing) {
  return entry.topics.length ? `<ul class="topics">${entry.topics.map((topic) =>
    `<li>${published(topic)}</li>`).join("")}</ul>` : "";
}
function where(stage: Stage, lang: Language) {
  return `${stage.city ? `${published(stage.city)} <span aria-hidden="true">·</span> ` : ""}${formats(lang)[stage.format]}`;
}
function timing(stage: Stage, lang: Language, detail = false) {
  const t = messages[lang];
  return `<dl class="timing">
    <div class="application"><dt>${t.application}</dt><dd>${stage.registrationDeadline ? date(stage.registrationDeadline, lang) : unknown(lang)}</dd></div>
    <div><dt>${t.eventDates}</dt><dd>${eventDates(stage.eventStart, stage.eventEnd, lang)}</dd></div>
    <div><dt>${t.submission}</dt><dd>${stage.submissionDeadline ? date(stage.submissionDeadline, lang)
      : stage.submissionDeadlineNote ? t.organizerTiming : unknown(lang)}</dd>
      ${detail && stage.submissionDeadlineNote ? `<dd class="timing-note">${published(stage.submissionDeadlineNote)}</dd>` : ""}</div>
  </dl>`;
}

type Context = {
  filters: Filters; section: Section; path?: string; pagePath?: string;
  privateLink?: string; privateSave?: { label: string; href: string };
};
function detailHref(id: string, filters: Filters, section: Section) {
  const query = new URLSearchParams(location(section, filters).split("?")[1]);
  if (section === "/archive") query.set("from", "archive");
  return listingPath(id) + (query.size ? `?${query}` : "");
}
function stageFor(entry: PublicListing, filters: Filters) {
  const scoped = audienceStages(entry, filters.audience);
  const relevant = scoped.filter((stage) => (!filters.city || lc(stage.city ?? "") === lc(filters.city))
    && (!filters.format || stage.format === filters.format));
  const stages = relevant.length ? relevant : scoped;
  return stages.find((stage) => stage.entry === "direct" && stage.status === "open"
    && stage.moroccoEligibility.status === "confirmed") ?? stages.find((stage) => stage.entry === "direct") ?? stages[0]!;
}
function card(entry: PublicListing, context: Context) {
  const { filters, section } = context, lang = filters.lang, t = messages[lang];
  const stage = stageFor(entry, filters);
  const eventDate = stage.eventStart ?? stage.eventEnd;
  const railDate = eventDate ? new Date(eventDate) : null;
  const zone = eventDate?.includes("T") ? "Africa/Casablanca" : "UTC";
  const rail = railDate ? `<span class="rail-month">${html(new Intl.DateTimeFormat(locale[lang], {
    month: "short", year: "numeric", timeZone: zone,
  }).format(railDate))}</span><span class="rail-day">${html(new Intl.DateTimeFormat(locale[lang], {
    day: "2-digit", timeZone: zone,
  }).format(railDate))}</span>` : `<span class="rail-month">${t.eventDates}</span><span class="rail-unknown">${t.unpublished}</span>`;
  return `<article class="card agenda-row" aria-label="${html(entry.title)}">
    <div class="date-rail" aria-hidden="true">${rail}</div>
    <div class="row-main"><div class="card-top"><span class="card-route">${labels(lang)[stage.category]}</span>${statusBadge(entry, lang)}</div>
      <h3>${published(entry.title)}</h3><p class="card-place">${where(stage, lang)}</p>${topics(entry)}
      ${entry.stages.length > 1 ? `<p class="stage-hint">${published(stage.name ?? t.event)} · ${entry.stages.length} ${t.stages}</p>` : ""}
    </div>
    <div class="row-dates">${timing(stage, lang)}</div>
    <a class="card-details" href="${html(detailHref(entry.id, filters, section))}" aria-label="${t.details}: ${html(entry.title)}">${t.details} ${arrow}</a>
  </article>`;
}

export function layout(title: string, section: "catalog" | "archive" | "detail", body: string, context: Context) {
  const { filters, path } = context, lang = filters.lang, t = messages[lang];
  const languageLinks = languages.map((language) => {
    const values = { ...filters, lang: language };
    const privateUrl = new URL(context.pagePath ?? "/", "http://local");
    if (language === "en") privateUrl.searchParams.delete("lang"); else privateUrl.searchParams.set("lang", language);
    const href = context.pagePath ? privateUrl.pathname + privateUrl.search
      : path ? detailHref(decodeURIComponent(path.slice("/hackathons/".length)), values, context.section)
      : location(context.section, values);
    return `<a lang="${language}" dir="${language === "ar" ? "rtl" : "ltr"}" href="${html(href)}"${language === lang ? ' aria-current="true"' : ""}>${({ en: "English", fr: "Français", ar: "العربية" })[language]}</a>`;
  }).join('<span aria-hidden="true"> · </span>');
  return `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${html(t.intro)}">
    <title>${html(title)} · Ouahad Hackathons</title><link rel="icon" href="/icons/app_icon.png">
    <link rel="stylesheet" href="/catalog.css">
    ${context.pagePath ? '<link rel="stylesheet" href="/private.css">' : ""}
  </head><body><a class="skip-link" href="#main">${t.skip}</a>
    <header class="header wrap"><div class="header-inner">
      <a class="brand" href="${html(location("/", { lang }))}" aria-label="${t.home}" dir="ltr">
        <img src="/icons/logo_black.png" width="54" height="54" alt=""><span>OUAHAD<span>SPACE</span></span></a>
      <a class="brand-section" href="${html(location("/", { lang }))}">Hackathons</a>
      <nav class="main-nav" aria-label="${t.mainNav}">
        <a href="${html(location("/", { ...filters, status: "" }))}"${section === "catalog" ? ' aria-current="page"' : ""}>${t.catalog}</a>
        <a href="${html(location("/archive", { ...filters, status: "" }))}"${section === "archive" ? ' aria-current="page"' : ""}>${t.archive}</a>
        ${context.privateLink ? `<a href="/my${lang === "en" ? "" : "?lang=" + lang}">${html(context.privateLink)}</a>` : ""}
      </nav>
      <nav class="languages" aria-label="${t.languageNav}" dir="ltr">${languageLinks}</nav>
    </div></header>
    <main id="main" class="wrap" tabindex="-1">${body}</main>
    <footer class="footer wrap"><span dir="ltr">OUAHAD SPACE / HACKATHONS</span><span>${t.timeNote}</span></footer>
  </body></html>`;
}

function select(name: string, label: string, first: string, values: [string, string][], selected: string) {
  const options: [string, string][] = selected && !values.some(([v]) => v === selected)
    ? [...values, [selected, selected]] : values;
  return `<div class="control"><label for="filter-${name}">${label}</label>
    <select id="filter-${name}" name="${name}"><option value="">${first}</option>
    ${options.map(([value, text]) => `<option dir="auto" value="${html(value)}"${value === selected ? " selected" : ""}>${html(text)}</option>`).join("")}</select></div>`;
}
function options(values: (string | null)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
    .map((value): [string, string] => [value, value]);
}
function chips(filters: Filters, section: Section) {
  const lang = filters.lang, t = messages[lang];
  const active = filterKeys.filter((key) => filters[key]);
  if (!active.length) return "";
  const names = keyLabels(lang);
  return `<nav class="applied" aria-label="${t.applied}">${active.map((key) => {
    const value = filters[key];
    const label = key === "format" ? formats(lang)[value as Stage["format"]] ?? value
      : key === "status" ? statuses(lang)[value as FilterStatus] ?? value : value;
    return `<a class="chip" href="${html(location(section, { ...filters, [key]: "" }))}" aria-label="${t.remove} ${names[key]}: ${html(label)}">
      ${names[key]}: ${published(label)} <span aria-hidden="true">×</span></a>`;
  }).join("")}<a class="clear-all" href="${html(location(section, { lang, audience: filters.audience }))}">${t.clear}</a></nav>`;
}

export function home(section: Section, entries: PublicListing[], filters: Filters, archiveCount: number, privateLink?: string) {
  const lang = filters.lang, t = messages[lang], archive = section === "/archive";
  const { inSection, matching } = filterCatalog(entries, filters, section);
  const hasFilters = filterKeys.some((key) => filters[key]);
  const stages = inSection.flatMap((entry) => audienceStages(entry, filters.audience));
  const statusOptions: [FilterStatus, string][] = archive
    ? [["applications-closed", t.closed], ["finished", t.finished]]
    : [["open", t.open], ["unknown", t.unknown], ["eligibility", t.eligibility]];
  const audienceLinks = ([[undefined, t.all], ...Object.entries(labels(lang))] as [Audience | undefined, string][])
    .map(([audience, label]) => `<a href="${html(location(section, { ...filters, audience }))}"${audience === filters.audience ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const empty = `<section class="empty" aria-label="${t.emptyLabel}"><span class="empty-index" aria-hidden="true">—</span>
    <h3>${hasFilters ? t.noMatches : archive ? t.emptyArchive : t.empty}</h3>
    <p>${hasFilters ? t.noMatchesCopy : archive ? t.emptyArchiveCopy : t.emptyCopy}</p>
    <a class="text-link" href="${html(hasFilters ? location(section, { lang, audience: filters.audience })
      : location(archive ? "/" : "/archive", { lang, audience: filters.audience }))}">${hasFilters ? t.clear : archive ? t.browse : t.viewArchive} ${arrow}</a></section>`;
  return layout(archive ? t.archive : t.catalog, archive ? "archive" : "catalog", `
    <section class="intro"><p class="kicker">${archive ? t.past : t.directory}</p>
      <div class="intro-line"><h1>${archive ? t.archiveTitle : t.title}</h1>
        <a class="text-link section-link" href="${html(location(archive ? "/" : "/archive", { lang, audience: filters.audience }))}">
          ${archive ? t.current : `${t.archive} <span class="count">${archiveCount}</span>`} ${arrow}</a></div>
      <p class="intro-copy">${archive ? t.archiveIntro : t.intro}</p>
    </section>
    <section class="directory" aria-labelledby="directory-title"><h2 id="directory-title" class="sr-only">${archive ? t.archived : t.browse}</h2>
      <nav class="audiences" aria-label="${t.locationNav}">${audienceLinks}</nav>
      <form class="filter-form" method="get" action="${section}">
        ${lang !== "en" ? `<input type="hidden" name="lang" value="${lang}">` : ""}
        ${filters.audience ? `<input type="hidden" name="audience" value="${filters.audience}">` : ""}
        <div class="searchbar">
          <label class="search-input"><span class="sr-only">${t.search}</span>${searchIcon()}
            <input type="search" name="q" value="${html(filters.q)}" placeholder="${t.placeholder}" maxlength="120" dir="auto"></label>
          <button class="search-submit" type="submit">${t.searchButton} ${arrow}</button>
        </div>
        <details class="filter-panel"><summary>${filterIcon()}${t.filters}<span class="filter-count">${filterKeys.filter((key) => key !== "q" && filters[key]).length || ""}</span></summary>
          <div class="filter-fields">
            ${select("field", t.field, t.allFields, options(inSection.flatMap((entry) => entry.topics)), filters.field)}
            ${select("city", t.city, t.allCities, options(stages.map((stage) => stage.city)), filters.city)}
            ${select("format", t.format, t.allFormats, Object.entries(formats(lang)), filters.format)}
            ${select("status", t.registration, t.anyStatus, statusOptions, filters.status)}
            <button class="button" type="submit">${t.apply} ${arrow}</button>
          </div>
        </details>
      </form>
      ${chips(filters, section)}
      <div class="results-head"><p><strong>${matching.length}</strong> ${matching.length === 1 ? t.countOne : t.count}</p>
        ${!archive ? `<a class="open-shortcut" href="${html(location("/", { ...filters, status: filters.status === "open" ? "" : "open" }))}"${filters.status === "open" ? ' aria-current="true"' : ""}>${t.openOnly} ${arrow}</a>` : ""}</div>
      ${matching.length ? `<div class="cards agenda">${matching.map((entry) => card(entry, { filters, section })).join("")}</div>` : empty}
    </section>`, { filters, section, privateLink });
}

function external(url: string | null, title: string, className = "link-row") {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  return `<a class="${className}" href="${html(url)}">${title} ${externalArrow}</a>`;
}
function eligibility(entry: PublicListing, stage: Stage, lang: Language) {
  const t = messages[lang], { status, note } = stage.moroccoEligibility;
  const label = status === "excluded" ? t.excluded
    : status === "unknown" || (entry.evidence.stale && !entry.archived) ? t.notVerified
      : entry.archived ? t.confirmedEdition : t.confirmed;
  return `<div class="eligibility"><strong>${label}</strong>${note ? `<p class="source-text">${published(note)}</p>` : ""}</div>`;
}

export function detail(entry: PublicListing, context: Context = {
  filters: parseFilters(new URLSearchParams()), section: entry.archived ? "/archive" : "/",
}) {
  const { filters, section } = context, lang = filters.lang, t = messages[lang];
  const hasStages = entry.stages.some((stage) => stage.name);
  const direct = entry.stages.filter((stage) => stage.entry === "direct");
  const registration = direct.find((stage) => stage.applicationUrl && stage.status === "open"
    && stage.moroccoEligibility.status === "confirmed") ?? direct.find((stage) => stage.applicationUrl);
  const stageNames = new Map(entry.stages.map((stage) => [stage.key, stage.name]));
  return layout(entry.title, "detail", `
    <nav class="back"><a href="${html(location(section, filters))}"><span class="back-arrow" aria-hidden="true">←</span>
      ${section === "/archive" ? t.backArchive : t.backCatalog}</a></nav>
    <header class="detail-head"><div class="detail-badges"><p class="kicker">${labels(lang)[entry.category]}</p>${statusBadge(entry, lang)}</div>
      <h1>${published(entry.title)}</h1><p>${entry.organizer ? `${t.organized} ${published(entry.organizer)}` : t.noOrganizer}</p>${topics(entry)}
      ${context.privateSave ? `<a class="text-link" href="${html(context.privateSave.href)}">${html(context.privateSave.label)} ${arrow}</a>` : ""}
    </header>
    <div class="detail-grid"><section class="detail-main" aria-labelledby="dates">
      <h2 id="dates">${hasStages ? t.stageDates : t.datesEligibility}</h2>
      ${entry.stages.map((stage) => `<article class="detail-panel">
        ${stage.name ? `<h3>${published(stage.name)}</h3>` : ""}
        <p class="card-place">${where(stage, lang)}${stage.entry === "advancement"
          ? ` · ${t.advance} ${published(stageNames.get(stage.requiresStage ?? "") ?? t.previous)}` : ""}</p>
        ${timing(stage, lang, true)}${eligibility(entry, stage, lang)}
        ${stage.registrationNote && !entry.archived ? `<p class="timing-note">${t.registrationNote}: ${published(stage.registrationNote)}</p>` : ""}
        ${hasStages ? `<div class="stage-links">${external(stage.applicationUrl, t.stageRegistration)}${external(stage.rulesUrl, t.stageRules)}${external(stage.evidenceUrl, t.stageSource)}</div>` : ""}
      </article>`).join("")}
    </section><aside class="official"><h2>${t.officialLinks}</h2>
      ${!entry.archived && registration && entry.confirmedOpen && registration.status === "open"
        && registration.moroccoEligibility.status === "confirmed" ? external(registration.applicationUrl, t.applyOfficial, "button") : ""}
      ${external(entry.eventUrl, t.officialEvent)}
      ${registration ? external(registration.applicationUrl, t.registrationPage) : ""}
      ${[...new Set(entry.stages.map((stage) => stage.rulesUrl).filter(Boolean))].map((url) => external(url, t.rules)).join("")}
      ${entry.evidence.organizer ? `<div class="source-note">${external(entry.evidence.organizer.url, t.verification)}
        <p>${t.lastCheck}: ${date(entry.evidence.organizer.checkedAt, lang)}.</p>
        ${entry.evidence.stale && !entry.archived ? `<p>${t.stale}</p>` : ""}</div>` : ""}
    </aside></div>`, { ...context, path: listingPath(entry.id) });
}

export function messagePage(kind: "notFound" | "unavailable", lang: Language = "en") {
  const t = messages[lang], filters = parseFilters(new URLSearchParams({ lang }));
  return layout(t[kind], "detail", `<section class="empty error-page"><h1>${t[kind]}</h1><p>${t[`${kind}Copy`]}</p>
    <a class="text-link" href="${html(location("/", filters))}">${t.browse} ${arrow}</a></section>`,
  { filters, section: "/" });
}

