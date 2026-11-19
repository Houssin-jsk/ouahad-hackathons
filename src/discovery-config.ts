import { z } from "zod";
import data from "../data/discovery-sources.json" with { type: "json" };

const source = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/), name: z.string().min(1),
  kind: z.enum(["rss", "hack-club"]), url: z.url({ protocol: /^https$/ }),
  category: z.enum(["morocco", "international-online"]),
  languages: z.array(z.enum(["en", "fr", "ar"])).min(1),
  match: z.enum(["opportunity", "game-off"]).default("opportunity"), enabled: z.boolean(),
});
export function parseDiscoveryConfig(value: unknown) {
  const result = z.array(source).parse(value);
  if (new Set(result.map(({ id }) => id)).size !== result.length) throw new Error("Duplicate discovery source ID");
  return result;
}
export const discoverySources = parseDiscoveryConfig(data);
export type DiscoverySource = typeof discoverySources[number];

// Match announcement titles in all three languages; never extract dates or eligibility from keywords.
export function opportunityTitle(title: string) {
  return /\b(?:hackathons?|hackatons?|datathons?|data[ -]challenges?|game[ -]jams?)\b|هاكاثون|هاكثون|هاكاتون|داتاثون|مسابقة.*(?:البيانات|البرمجة)/iu.test(title);
}
