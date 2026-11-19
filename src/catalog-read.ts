import type { Database } from "./local-d1.ts";
import { elapsed } from "./model.ts";
import type { EventStage, Opportunity } from "./model.ts";

export const publicViews = ["all", "open", "archive"] as const;
export const audiences = ["morocco", "international-online"] as const;
export type PublicView = typeof publicViews[number];
export type Audience = typeof audiences[number];
export type CatalogStatus = "open" | "unknown" | "applications-closed" | "finished";

// A feed fetch cannot renew the organizer's evidence. Keep dated claims in the archive.
const maxReviewAgeMs = 30 * 24 * 60 * 60 * 1000;

function currentStage(stage: EventStage, fresh: boolean, now: Date) {
  const { registrationStatus, ...facts } = stage;
  const status = elapsed(stage.eventEnd, stage.timeZone, now) ? "finished"
    : elapsed(stage.registrationDeadline, stage.timeZone, now) || registrationStatus === "closed" ? "closed"
      : registrationStatus === "open" && fresh ? "open" : "unknown";
  return { ...facts, status } as const;
}

export async function publicCatalog(
  db: Database, view: PublicView,
  { audience, id, now = new Date() }: { audience?: Audience; id?: string; now?: Date } = {},
) {
  const { results } = await db.prepare(`
    SELECT e.id, e.competition_id AS competitionId, r.snapshot, s.facts
    FROM editions e
    JOIN edition_revisions r ON r.id = e.approved_revision_id AND r.review_state = 'approved'
    JOIN stages s ON s.revision_id = r.id
    WHERE e.publication_state = 'published' AND (?1 IS NULL OR e.id = ?1)
    ORDER BY e.id, s.position
  `).bind(id ?? null).all<{ id: string; competitionId: string; snapshot: string; facts: string }>();
  const grouped = new Map<string, {
    id: string; competitionId: string; row: Omit<Opportunity, "publication" | "firstImportedAt">;
    stages: EventStage[];
  }>();
  for (const result of results) {
    let item = grouped.get(result.id);
    if (!item) {
      item = { id: result.id, competitionId: result.competitionId,
        row: JSON.parse(result.snapshot), stages: [] };
      grouped.set(result.id, item);
    }
    item.stages.push(JSON.parse(result.facts));
  }
  return [...grouped.values()].flatMap(({ id, competitionId, row, stages }) => {
    const reviewAge = row.review ? now.getTime() - Date.parse(row.review.checkedAt) : Infinity;
    const fresh = reviewAge >= 0 && reviewAge <= maxReviewAgeMs;
    const current = stages.map((stage) => currentStage(stage, fresh, now));
    const direct = current.filter((stage) => stage.entry === "direct");
    const status: CatalogStatus = current.every((stage) => stage.status === "finished") ? "finished"
      : direct.some((stage) => stage.status === "open") ? "open"
        : direct.length && direct.every((stage) => stage.status === "closed" || stage.status === "finished")
          ? "applications-closed" : "unknown";
    const archived = status === "finished" || status === "applications-closed";
    const matchesAudience = (stage: typeof current[number]) => {
      if (!audience) return true;
      if (audience === "morocco") return stage.category === "morocco";
      return (stage.category === "international-online" || stage.onlineFromMorocco)
        && stage.moroccoEligibility.status === "confirmed" && (fresh || archived);
    };
    const confirmedOpen = fresh && direct.some((stage) => matchesAudience(stage)
      && stage.status === "open" && stage.moroccoEligibility.status === "confirmed");
    if (!current.some(matchesAudience) || (view === "archive" && !archived)
      || (view === "open" && !confirmedOpen)) return [];
    return [{
      id, competitionId, title: row.title, organizer: row.organizer ?? null,
      topics: row.topics, category: row.category, summaries: row.summaries ?? {},
      format: row.format, city: row.city, countryCode: row.countryCode, eventUrl: row.eventUrl,
      status, archived, confirmedOpen, stages: current,
      evidence: { organizer: row.review, sourceUrl: row.provenance.url, stale: !fresh },
    }];
  });
}

export type PublicListing = Awaited<ReturnType<typeof publicCatalog>>[number];
