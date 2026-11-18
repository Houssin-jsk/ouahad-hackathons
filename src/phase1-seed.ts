import { readFile } from "node:fs/promises";
import { automaticSources, loadReviews, manualSource } from "./sources.ts";

// Recorded in the Phase 1 catalog on its final live validation; replay does not reverify evidence.
const captureTimes: Record<string, string> = {
  "uca-rss": "2026-11-17T14:35:07.972Z",
  "hack-club": "2026-11-17T14:35:06.927Z",
};

export async function phase1Sources() {
  const [reviews, rss, api] = await Promise.all([
    loadReviews("data/source-reviews.json"),
    readFile(new URL("../test/fixtures/uca-rss.xml", import.meta.url), "utf8"),
    readFile(new URL("../test/fixtures/hack-club.json", import.meta.url), "utf8"),
  ]);
  return [
    manualSource("data/references.json"),
    ...automaticSources(reviews, async (request) =>
      new Response(String(request).startsWith("https://hackclub.com/") ? api : rss),
    (source) => captureTimes[source]!),
  ];
}
