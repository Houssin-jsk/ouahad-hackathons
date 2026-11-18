import { z } from "zod";
import { reviewRow } from "./model.ts";

export function parseReviews(input: unknown) {
  const reviews = z.array(reviewRow).refine((rows) => new Set(rows.map(
    ({ source, externalId }) => JSON.stringify([source, externalId]),
  )).size === rows.length, "Duplicate review IDs").parse(input);
  for (const { source } of reviews) {
    if (source !== "uca-rss" && source !== "hack-club") {
      throw new Error(`Unrecognized reviewed automatic source: ${source}`);
    }
  }
  return reviews;
}
