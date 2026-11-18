import { randomUUID } from "node:crypto";
import { importIntoD1 } from "./catalog-write.ts";
import type { Source } from "./importer.ts";
import type { Database } from "./local-d1.ts";
import type { ReviewRow } from "./model.ts";
import { dailySourceNames, dailySources } from "./sources-automatic.ts";
import type { Fetcher } from "./sources-automatic.ts";

import { dailyCron } from "./sync-schedule.ts";
export { dailyCron } from "./sync-schedule.ts";
export const leaseMs = 120_000;

type SourceRun = {
  id: string; source: string; outcome: "running" | "success" | "failed" | "skipped-overlap" | "abandoned";
  started_at: string; finished_at: string | null; duration_ms: number | null; attempts: number;
  new_drafts: number; proposed_changes: number; unchanged_records: number;
  new_candidates: number; processed_records: number; error: string | null;
};
type Job = { id: string; trigger: string; started_at: string };

export async function inspectSync(db: Database, jobId: string, now = new Date()) {
  const job = await db.prepare("SELECT id, trigger, started_at FROM sync_runs WHERE id = ?").bind(jobId).first<Job>();
  if (!job) throw new Error(`Unknown sync run: ${jobId}`);
  const { results } = await db.prepare("SELECT * FROM sync_source_runs WHERE job_id = ? ORDER BY source")
    .bind(jobId).all<SourceRun>();
  return { ...job, sources: results.map((row) => ({
    ...row, outcome: row.outcome === "running" && now.getTime() - Date.parse(row.started_at) >= leaseMs
      ? "abandoned" as const : row.outcome,
  })) };
}

export async function runDailySync(
  db: Database, {
    reviews, runId = randomUUID(), trigger = "manual", clock = () => new Date(), fetcher = fetch,
    sources,
  }: {
    reviews: ReviewRow[]; runId?: string; trigger?: "manual" | "scheduled"; clock?: () => Date;
    fetcher?: Fetcher; sources?: Source[];
  },
) {
  const startedAt = clock().toISOString();
  const attempts = new Map<string, number>();
  const selected = sources ?? dailySources(reviews, fetcher, clock,
    (name) => attempts.set(name, (attempts.get(name) ?? 0) + 1));
  if (new Set(selected.map(({ name }) => name)).size !== selected.length) {
    throw new Error("Duplicate sync source names");
  }
  const planned = selected.map(({ name }) => ({ id: randomUUID(), source: name }));
  const rosterToken = randomUUID();
  // The scheduled event ID is stable across retries; create the complete source roster atomically.
  const [created] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO sync_runs (id, trigger, started_at, roster_token) VALUES (?, ?, ?, ?)")
      .bind(runId, trigger, startedAt, rosterToken),
    ...planned.map(({ id, source }) => db.prepare(`INSERT OR IGNORE INTO sync_source_runs
      (id, job_id, source, started_at, outcome)
      SELECT ?, ?, ?, ?, 'running' FROM sync_runs WHERE id = ? AND roster_token = ?`)
      .bind(id, runId, source, startedAt, runId, rosterToken)),
  ]);
  if (created?.meta.changes !== 1) return { replay: true, ...await inspectSync(db, runId, clock()) };

  await Promise.all(selected.map(async (source, index) => {
    const id = planned[index]!.id;
    const started = clock().toISOString();
    const expiry = new Date(Date.parse(started) + leaseMs).toISOString();
    const [claimed] = await db.batch([
      db.prepare(`INSERT INTO sync_leases (source, run_id, expires_at) VALUES (?, ?, ?)
        ON CONFLICT (source) DO UPDATE SET run_id = excluded.run_id, expires_at = excluded.expires_at
        WHERE sync_leases.expires_at <= ?`).bind(source.name, id, expiry, started),
      db.prepare("UPDATE sync_source_runs SET started_at = ? WHERE id = ?").bind(started, id),
      db.prepare(`UPDATE sync_source_runs SET outcome = 'abandoned', finished_at = ?,
        error = 'Sync lease expired before completion'
        WHERE source = ? AND id <> ? AND outcome = 'running'
          AND started_at <= ?`)
        .bind(started, source.name, id, new Date(Date.parse(started) - leaseMs).toISOString()),
    ]);
    if (claimed?.meta.changes !== 1) {
      await db.prepare(`UPDATE sync_source_runs SET outcome = 'skipped-overlap', finished_at = ?, duration_ms = 0,
        error = 'Another run owns this source; inspect its run ID' WHERE id = ?`)
        .bind(started, id).run();
      return;
    }
    try {
      const report = await importIntoD1(db, [source], {
        now: new Date(started), clock,
        monitor: { runId: id, source: source.name, startedAt: started, attempts: () => attempts.get(source.name) ?? 0 },
      });
      const result = report.sources[0];
      if (!result?.ok) throw new Error(result?.error ?? "Source import failed");
    } catch (error) {
      const finished = clock().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await db.batch([
        db.prepare(`UPDATE sync_source_runs SET outcome = 'failed', error = ?, finished_at = ?,
          duration_ms = ?, attempts = ? WHERE id = ? AND outcome = 'running'`)
          .bind(message, finished, Math.max(0, Date.parse(finished) - Date.parse(started)),
            attempts.get(source.name) ?? 0, id),
        db.prepare(`INSERT INTO source_health (source, last_attempt_at, error)
          SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM sync_leases WHERE source = ? AND run_id = ?)
          ON CONFLICT (source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, error = excluded.error`)
          .bind(source.name, started, message, source.name, id),
      ]);
    } finally {
      await db.prepare("DELETE FROM sync_leases WHERE source = ? AND run_id = ?").bind(source.name, id).run();
    }
  }));
  return { replay: false, ...await inspectSync(db, runId, clock()) };
}

export async function syncStatus(db: Database, now = new Date()) {
  const sources = [];
  const names = new Set<string>([
    ...dailySourceNames,
    ...(await db.prepare("SELECT DISTINCT source FROM sync_source_runs").all<{ source: string }>()).results.map(({ source }) => source),
  ]);
  for (const source of names) {
    const latest = await db.prepare("SELECT * FROM sync_source_runs WHERE source = ? ORDER BY rowid DESC LIMIT 1")
      .bind(source).first<SourceRun>();
    const success = await db.prepare(`SELECT finished_at FROM sync_source_runs
      WHERE source = ? AND outcome = 'success' ORDER BY finished_at DESC LIMIT 1`)
      .bind(source).first<string>("finished_at");
    const lease = await db.prepare("SELECT run_id, expires_at FROM sync_leases WHERE source = ?")
      .bind(source).first<{ run_id: string; expires_at: string }>();
    const health = await db.prepare("SELECT missing_reviewed_ids FROM source_health WHERE source = ?")
      .bind(source).first<string>("missing_reviewed_ids");
    sources.push({
      source, lastSuccessAt: success, stale: !success || now.getTime() - Date.parse(success) > 48 * 60 * 60 * 1000,
      latest: latest ? { ...latest,
        outcome: latest.outcome === "running" && now.getTime() - Date.parse(latest.started_at) >= leaseMs
          ? "abandoned" : latest.outcome,
      } : null, activeLease: lease && Date.parse(lease.expires_at) > now.getTime() ? lease : null,
      missingReviewedIds: JSON.parse(health ?? "[]") as string[],
    });
  }
  const recheck = (await db.prepare(`
    SELECT e.id AS editionId, e.publication_state AS publicationState,
      json_extract(r.snapshot, '$.title') AS title,
      json_extract(r.snapshot, '$.review.checkedAt') AS reviewedAt
    FROM editions e JOIN edition_revisions r ON r.id = COALESCE(e.approved_revision_id, e.pending_revision_id)
    WHERE json_extract(r.snapshot, '$.review.checkedAt') IS NULL
      OR julianday(json_extract(r.snapshot, '$.review.checkedAt')) < julianday(?, '-30 days')
      OR julianday(json_extract(r.snapshot, '$.review.checkedAt')) > julianday(?)
    ORDER BY e.id
  `).bind(now.toISOString(), now.toISOString()).all()).results;
  const disagreements = (await db.prepare(`
    SELECT s.source, s.external_id AS externalId, e.id AS editionId, j.key AS field,
      j.value AS observedValue, json_extract(r.snapshot, '$.' || j.key) AS reviewedValue
    FROM source_evidence s JOIN editions e ON e.id = s.edition_id
    JOIN edition_revisions r ON r.id = COALESCE(e.pending_revision_id, e.approved_revision_id)
    JOIN json_each(s.observation) j
    WHERE j.key IN ('title', 'eventUrl', 'eventStart', 'eventEnd', 'format')
      AND j.value IS NOT NULL AND j.value <> 'unknown'
      AND json_extract(r.snapshot, '$.' || j.key) IS NOT NULL
      AND j.value IS NOT json_extract(r.snapshot, '$.' || j.key)
    ORDER BY s.source, s.external_id, j.key
  `).all()).results;
  const runs = (await db.prepare("SELECT id, trigger, started_at FROM sync_runs ORDER BY rowid DESC LIMIT 20").all<Job>()).results;
  return {
    intendedCronUTC: dailyCron, staleAfterHours: 48, sources,
    organizerEvidenceNeedsRechecking: recheck, sourceEvidenceDisagreements: disagreements, recentRuns: runs,
    coverage: {
      "uca-rss": { refreshes: "UCA news titles, GUIDs and official links; hackathon keyword discovery",
        needsReview: "Dates, application status, Morocco eligibility, rules and stages" },
      "hack-club": { refreshes: "Online hackathon/jam identities, titles, sites and program date windows",
        needsReview: "Morocco eligibility, registration/submission deadlines and required attendance" },
      "github-gaming-rss": { refreshes: "Game Off announcement candidates; excludes titles marked winners or results",
        needsReview: "Match to an existing edition before manual intake; no dates or eligibility inferred from posts" },
      manual: "Organizer pages and feeds outside this small set remain manual intake; none are fetched by the schedule",
    },
  };
}
