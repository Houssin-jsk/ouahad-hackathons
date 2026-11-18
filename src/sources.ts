import { z } from "zod";
import { manualRow } from "./model.ts";
import { parseReviews } from "./review-policy.ts";
import { readJson } from "./store.ts";
import type { Source } from "./importer.ts";

export { automaticSources } from "./sources-automatic.ts";
export type { Fetcher } from "./sources-automatic.ts";

export async function loadReviews(path: string) {
  return parseReviews(await readJson(path));
}

export function manualSource(path: string): Source {
  return {
    name: `manual: ${path}`,
    async load() {
      const rows = z.array(manualRow).parse(await readJson(path));
      return {
        records: rows.map(({ source, externalId, ...fields }) => {
          if (source === "uca-rss" || source === "hack-club") {
            throw new Error(`Use the reviews file for automatic source ${source}`);
          }
          return {
            ...fields,
            provenance: { method: "manual", source, externalId, ...fields.review },
          };
        }),
      };
    },
  };
}
