import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import type { Batch, Source } from "./importer.ts";
import type { Candidate, ReviewRow } from "./model.ts";

const HACK_CLUB = "https://hackclub.com/api/v1/events";
const UCA = "https://cim.uca.ma/feed/";
export type Fetcher = typeof fetch;

const hackClubFeed = z.object({
  data: z.array(z.object({
    id: z.string(),
    name: z.string(),
    url: z.url({ protocol: /^https?$/ }).nullable(),
    format: z.enum(["online", "in-person", "both"]).nullable(),
    description: z.string().nullable(),
    startDate: z.iso.date(),
    endDate: z.iso.date().nullable(),
  })),
  meta: z.object({ count: z.number().int().nonnegative() }),
}).refine((value) => value.meta.count === value.data.length, "Hack Club count mismatch");

const ucaFeed = z.object({
  rss: z.object({
    channel: z.object({
      title: z.string(),
      item: z.array(z.object({
        title: z.string(),
        link: z.url({ protocol: /^https?$/ }),
        guid: z.string().min(1),
      })).default([]),
    }),
  }),
});

export async function downloadText(
  fetcher: Fetcher, href: string, accept: string, attempt: () => void = () => {},
) {
  for (let index = 0; index < 3; index++) {
    attempt();
    let retry = true;
    try {
      const response = await fetcher(href, { headers: { accept }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        retry = response.status === 408 || response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} from ${href}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`Empty body from ${href}`);
      const decoder = new TextDecoder();
      let size = 0, body = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) {
            retry = false;
            throw new Error(`Source response exceeds 2 MiB: ${href}`);
          }
          body += decoder.decode(value, { stream: true });
        }
        return body + decoder.decode();
      } finally {
        await reader.cancel();
      }
    } catch (error) {
      if (!retry || index === 2) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 250 * (index + 1)));
    }
  }
  throw new Error("Unreachable retry state");
}

type FeedRow = Omit<Candidate, "provenance">;
type Discovered = { externalId: string; row: FeedRow };
function validRss(xml: string) {
  // Article HTML in CDATA is text; reject DTD/entity declarations in the XML itself.
  const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  return !/<!DOCTYPE|<!ENTITY/i.test(markup) && XMLValidator.validate(xml) === true;
}

function select(
  name: string, feedUrl: string, rows: Discovered[], reviews: ReviewRow[], checkedAt: string,
): Batch {
  const selected = new Map(reviews.filter((row) => row.source === name)
    .map((row) => [row.externalId, row.facts]));
  const seen = new Set<string>();
  const records: Candidate[] = [];
  const needsReview: NonNullable<Batch["needsReview"]> = [];
  for (const { externalId, row } of rows) {
    if (seen.has(externalId)) throw new Error(`Duplicate feed ID: ${externalId}`);
    seen.add(externalId);
    const facts = selected.get(externalId);
    if (!facts) {
      needsReview.push({ externalId, title: row.title, url: row.eventUrl });
    } else {
      records.push({
        ...row, ...facts, provenance: { source: name, externalId, method: "automatic", url: feedUrl, checkedAt },
      });
    }
  }
  return {
    records, needsReview, missingReviewedIds: [...selected.keys()].filter((id) => !seen.has(id)),
    observations: rows.map(({ externalId, row }) => ({
      source: name, externalId, feedUrl, checkedAt, fields: row,
    })),
  };
}

export function automaticSources(
  reviews: ReviewRow[], fetcher: Fetcher = fetch, checkedAt = (_source: string) => new Date().toISOString(),
  onAttempt = (_source: string) => {},
): Source[] {
  const reviewed = (source: string, externalId: string) =>
    reviews.some((row) => row.source === source && row.externalId === externalId);
  return [
    {
      name: "uca-rss",
      async load() {
        const xml = await downloadText(fetcher, UCA, "application/rss+xml", () => onAttempt("uca-rss"));
        if (!validRss(xml)) {
          throw new Error("Invalid UCA RSS document");
        }
        const parsed: unknown = new XMLParser({
          parseTagValue: false, htmlEntities: true,
          isArray: (_name, path) => path === "rss.channel.item",
        }).parse(xml);
        const { rss } = ucaFeed.parse(parsed);
        return select("uca-rss", UCA, rss.channel.item
          .filter((item) => reviewed("uca-rss", item.guid) || /\bhackathon\b/i.test(item.title))
          .map((item) => ({
            externalId: item.guid,
            // RSS pubDate is when the news was posted, not an event date.
            row: { title: item.title, eventUrl: item.link, category: "morocco", format: "unknown" },
          })), reviews, checkedAt("uca-rss"));
      },
    },
    {
      name: "hack-club",
      async load() {
        const body = await downloadText(fetcher, HACK_CLUB, "application/json", () => onAttempt("hack-club"));
        const { data } = hackClubFeed.parse(JSON.parse(body));
        return select("hack-club", HACK_CLUB, data.flatMap((event) => {
          // "both" programs can be online qualifiers for an in-person hackathon.
          if (event.format !== "online" || !event.url
            || (!reviewed("hack-club", event.id)
              && !/\b(?:hackathon|jam)\b/i.test(`${event.name} ${event.description ?? ""}`))) return [];
          return [{
            externalId: event.id,
            row: {
              title: event.name, eventUrl: event.url, category: "international-online", format: "online",
              eventStart: event.startDate, eventEnd: event.endDate,
            },
          }];
        }), reviews, checkedAt("hack-club"));
      },
    },
  ];
}

export const dailySourceNames = ["uca-rss", "hack-club", "github-gaming-rss"] as const;

export function dailySources(
  reviews: ReviewRow[], fetcher: Fetcher = fetch,
  clock = () => new Date(), onAttempt = (_source: string) => {},
): Source[] {
  const feedUrl = "https://github.blog/open-source/gaming/feed/";
  return [
    ...automaticSources(reviews, fetcher, () => clock().toISOString(), onAttempt),
    {
      name: "github-gaming-rss",
      async load() {
        const xml = await downloadText(fetcher, feedUrl, "application/rss+xml",
          () => onAttempt("github-gaming-rss"));
        if (!validRss(xml)) {
          throw new Error("Invalid GitHub gaming RSS document");
        }
        const parsed: unknown = new XMLParser({
          parseTagValue: false, htmlEntities: true, isArray: (_name, path) => path === "rss.channel.item",
        }).parse(xml);
        const { rss } = ucaFeed.parse(parsed);
        const entries = rss.channel.item.filter((item) =>
          /\bgame off\b/i.test(item.title) && !/\bwinners?\b|\bresults\b|\bhighlights\b/i.test(item.title));
        const checkedAt = clock().toISOString();
        // Discovery only: the post date is not an event date and does not establish eligibility.
        return {
          records: [],
          needsReview: entries.map((item) => ({ externalId: item.guid, title: item.title, url: item.link })),
          observations: entries.map((item) => ({
            source: "github-gaming-rss", externalId: item.guid, feedUrl, checkedAt,
            fields: { title: item.title, eventUrl: item.link, category: "international-online", format: "unknown" },
          })),
        };
      },
    },
  ];
}

