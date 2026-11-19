import { createHash, randomUUID } from "node:crypto";
import { collectBatches } from "./importer.ts";
import type { Source, SourceObservation } from "./importer.ts";
import type { Database } from "./local-d1.ts";
import { eventStages } from "./model.ts";
import type { EventStage, Opportunity } from "./model.ts";

type DbValue = string | number | null;
type Statement = ReturnType<Database["prepare"]>;
const statement = (db: Database, sql: string, ...values: DbValue[]) =>
  db.prepare(sql).bind(...values);

function officialKey(value: string) {
  const url = new URL(value); url.hash = "";
  url.hostname = url.hostname.replace(/^www\./, "");
  return url.href.replace(/\/$/, "");
}

export async function possibleEditionMatches(db: Database, title: string, url: string) {
  const rows = (await db.prepare(`SELECT e.id, r.snapshot FROM editions e JOIN edition_revisions r
    ON r.id = COALESCE(e.pending_revision_id, e.approved_revision_id)`).all<{ id: string; snapshot: string }>()).results;
  const key = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]/gu, "");
  return rows.flatMap((row) => {
    const facts = JSON.parse(row.snapshot) as Opportunity;
    const sameLink = officialKey(facts.eventUrl) === officialKey(url);
    return sameLink || key(facts.title) === key(title) ? [{ id: row.id, title: facts.title,
      reason: sameLink ? "same-official-url" : "same-title-needs-evidence" }] : [];
  });
}

function evidence(db: Database, observation: SourceObservation, editionId: string | null, runId: string | null) {
  const { source, externalId, feedUrl, checkedAt, fields } = observation;
  return statement(db, `
    INSERT INTO source_evidence (source, external_id, edition_id, source_url, checked_at, observation, first_seen_run)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, external_id) DO UPDATE SET
      edition_id = COALESCE(excluded.edition_id, source_evidence.edition_id),
      source_url = excluded.source_url, checked_at = excluded.checked_at, observation = excluded.observation
    WHERE julianday(excluded.checked_at) >= julianday(source_evidence.checked_at)
       OR (source_evidence.edition_id IS NULL AND excluded.edition_id IS NOT NULL)
  `, source, externalId, editionId, feedUrl, checkedAt, JSON.stringify(fields), runId);
}

function proposal(db: Database, row: Opportunity, now: string, seedOnly: boolean, runId: string | null) {
  const { firstImportedAt, publication: _draft, ...snapshot } = row;
  const { checkedAt: _fetched, ...sourceIdentity } = snapshot.provenance;
  const digest = createHash("sha256")
    .update(JSON.stringify({ ...snapshot, provenance: sourceIdentity })).digest("hex");
  const { id } = row;
  const competition = `competition:${id}`;
  const revision = randomUUID();
  const stages = eventStages(row);
  const changed = "last_fingerprint IS NOT ? AND (? = 0 OR last_fingerprint IS NULL)";
  const seedFlag = Number(seedOnly);
  return [
    statement(db, "INSERT OR IGNORE INTO competitions (id, created_at) VALUES (?, ?)",
      competition, firstImportedAt),
    statement(db, `INSERT OR IGNORE INTO editions (id, competition_id, first_imported_at, created_by_run)
      VALUES (?, ?, ?, ?)`, id, competition, firstImportedAt, runId),
    statement(db, `
      INSERT INTO edition_revisions (id, edition_id, fingerprint, proposed_at, snapshot, source_run_id)
      SELECT ?, id, ?, ?, ?, ? FROM editions
      WHERE id = ? AND ${changed}
        AND NOT EXISTS (SELECT 1 FROM edition_revisions
          WHERE id = editions.approved_revision_id AND fingerprint = ?
            AND editions.publication_state = 'published')
    `, revision, digest, now, JSON.stringify(snapshot), runId, id, digest, seedFlag, digest),
    ...stages.map((stage, index) => statement(db, `
      INSERT INTO stages (revision_id, stage_key, position, name, entry_method, requires_stage_key, facts)
      SELECT id, ?, ?, ?, ?, ?, ? FROM edition_revisions WHERE id = ?
    `, stage.key, index, stage.name, stage.entry, stage.requiresStage, JSON.stringify(stage), revision)),
    statement(db, `UPDATE edition_revisions SET review_state = 'superseded'
      WHERE id = (SELECT pending_revision_id FROM editions WHERE id = ? AND ${changed})`,
    id, digest, seedFlag),
    statement(db, `UPDATE editions
      SET last_fingerprint = ?, pending_revision_id = (SELECT id FROM edition_revisions WHERE id = ?)
      WHERE id = ? AND ${changed}`, digest, revision, id, digest, seedFlag),
  ];
}

export type ImportMonitor = { runId: string; source: string; startedAt: string; attempts: () => number };

export async function importIntoD1(
  db: Database, sources: Source[],
  { now = new Date(), seedOnly = false, monitor, clock = () => new Date() }: {
    now?: Date; seedOnly?: boolean; monitor?: ImportMonitor; clock?: () => Date;
  } = {},
) {
  const stamp = now.toISOString();
  const batches = await collectBatches(sources, now);
  const report = [];
  for (const [index, result] of batches.entries()) {
    const source = sources[index]!.name;
    try {
      if (result.status === "rejected") throw result.reason;
      const { staged, details, observations = [] } = result.value;
      const observed = new Map(observations.map((item) => [
        JSON.stringify([item.source, item.externalId]), item,
      ]));
      const statements: Statement[] = [];
      const revisionIndices: number[] = [];
      const runId = monitor?.runId ?? null;
      const finishedAt = monitor ? clock().toISOString() : stamp;
      if (monitor) statements.push(statement(db, `
        INSERT INTO sync_guards (id, valid) VALUES (?, EXISTS (
          SELECT 1 FROM sync_leases WHERE source = ? AND run_id = ? AND expires_at > ?
        ))`, runId, monitor.source, runId, finishedAt));
      const canonicalSeen = new Set<string>();
      for (const row of staged.values()) {
        const { source, externalId, checkedAt, url: feedUrl } = row.provenance;
        const rawKey = JSON.stringify([source, externalId]);
        // A second feed/reference must not silently create a duplicate edition. Keep its evidence
        // in the candidate queue for an owner to compare; never merge by title or guess a relationship.
        const canonical = JSON.stringify([officialKey(row.eventUrl), row.title]);
        const duplicate = canonicalSeen.has(canonical) || (await possibleEditionMatches(db, row.title, row.eventUrl))
          .some((match) => match.id !== row.id && match.reason === "same-official-url" && match.title === row.title);
        if (duplicate) {
          statements.push(evidence(db, observed.get(rawKey) ?? {
            source, externalId, checkedAt, feedUrl, fields: row,
          }, null, runId));
          observed.delete(rawKey);
          continue;
        }
        canonicalSeen.add(canonical);
        revisionIndices.push(statements.length + 2);
        statements.push(...proposal(db, row, stamp, seedOnly, runId));
        statements.push(evidence(db, observed.get(rawKey) ?? {
          source, externalId, checkedAt, feedUrl, fields: row,
        }, row.id, runId));
        observed.delete(rawKey);
      }
      for (const item of observed.values()) statements.push(evidence(db, item, null, runId));
      if (!seedOnly) statements.push(statement(db, `
        INSERT INTO source_health (source, last_attempt_at, last_success_at, missing_reviewed_ids)
        VALUES (?, ?, ?, ?) ON CONFLICT (source) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at,
          missing_reviewed_ids = excluded.missing_reviewed_ids, error = NULL
      `, source, stamp, finishedAt, JSON.stringify(details.missingReviewedIds ?? [])));
      if (monitor) {
        statements.push(statement(db, `UPDATE sync_source_runs SET outcome = 'success', finished_at = ?,
          duration_ms = ?, attempts = ?, processed_records = ?,
          new_drafts = (SELECT count(*) FROM editions WHERE created_by_run = ?),
          proposed_changes = (SELECT count(*) FROM edition_revisions r JOIN editions e ON e.id = r.edition_id
            WHERE r.source_run_id = ? AND e.created_by_run IS NOT ?),
          new_candidates = (SELECT count(*) FROM source_evidence WHERE first_seen_run = ? AND edition_id IS NULL),
          unchanged_records = ? - (SELECT count(*) FROM edition_revisions WHERE source_run_id = ?)
          WHERE id = ?`,
        finishedAt, Math.max(0, Date.parse(finishedAt) - Date.parse(monitor.startedAt)),
        monitor.attempts(), staged.size, runId, runId, runId, runId, staged.size, runId, runId));
        statements.push(statement(db, "DELETE FROM sync_guards WHERE id = ?", runId));
      }
      const results = statements.length ? await db.batch(statements) : [];
      const queued = revisionIndices.reduce((count, i) => count + (results[i]?.meta.changes ?? 0), 0);
      report.push({ source, ok: true, processed: staged.size, queued, ...details });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The monitored runner owns failure history and the lease; it will finish the source independently.
      if (!seedOnly && !monitor) await statement(db, `
        INSERT INTO source_health (source, last_attempt_at, error) VALUES (?, ?, ?)
        ON CONFLICT (source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, error = excluded.error
      `, source, stamp, message).run();
      report.push({ source, ok: false, error: message });
    }
  }
  const totals = await db.prepare(`SELECT count(*) AS editions,
    count(*) FILTER (WHERE publication_state = 'draft') AS drafts,
    count(*) FILTER (WHERE publication_state = 'published') AS published
    FROM editions`).first();
  return { totals, sources: report };
}

export async function pendingReviews(db: Database) {
  return (await db.prepare(`
    SELECT e.id AS editionId, e.publication_state AS publicationState,
      r.id AS revisionId, r.proposed_at AS proposedAt, json_extract(r.snapshot, '$.title') AS title
    FROM editions e JOIN edition_revisions r ON r.id = e.pending_revision_id
    WHERE r.review_state = 'pending' ORDER BY e.id
  `).all()).results;
}

export async function sourceQueue(db: Database, now = new Date()) {
  const candidates = (await db.prepare(`
    SELECT source, external_id AS externalId, source_url AS sourceUrl, checked_at AS checkedAt,
      json_extract(observation, '$.title') AS title, json_extract(observation, '$.eventUrl') AS eventUrl
    FROM source_evidence WHERE edition_id IS NULL ORDER BY source, external_id
  `).all<{ source: string; externalId: string; sourceUrl: string; checkedAt: string; title: string; eventUrl: string }>()).results;
  const health = (await db.prepare("SELECT * FROM source_health ORDER BY source")
    .all<{ source: string; error: string | null; last_success_at: string | null; missing_reviewed_ids: string }>()).results;
  return { candidates: await Promise.all(candidates.map(async (candidate) => ({ ...candidate,
    possibleExistingEditions: await possibleEditionMatches(db, candidate.title, candidate.eventUrl),
  }))), health: health.map((row) => ({
    ...row, missing_reviewed_ids: JSON.parse(row.missing_reviewed_ids) as string[],
    stale: !row.last_success_at || now.getTime() - Date.parse(row.last_success_at) > 48 * 60 * 60 * 1000,
  })) };
}

export async function inspectEdition(db: Database, id: string) {
  const edition = await statement(db, `
    SELECT id, competition_id AS competitionId, first_imported_at AS firstImportedAt,
      publication_state AS publicationState, pending_revision_id AS pendingId,
      approved_revision_id AS approvedId FROM editions WHERE id = ?
  `, id).first<{
    id: string; competitionId: string; firstImportedAt: string;
    publicationState: "draft" | "published" | "rejected" | "withdrawn";
    pendingId: string | null; approvedId: string | null;
  }>();
  if (!edition) throw new Error(`Unknown edition: ${id}`);
  const revisions = (await statement(db, `SELECT id, review_state AS state,
    proposed_at AS proposedAt, decided_at AS decidedAt, decision_note AS note, snapshot
    FROM edition_revisions WHERE edition_id = ? ORDER BY proposed_at, rowid`, id)
    .all<{ id: string; state: string; proposedAt: string; decidedAt: string | null; note: string | null; snapshot: string }>()).results;
  const sources = (await statement(db, "SELECT * FROM source_evidence WHERE edition_id = ?", id)
    .all<{ observation: string }>()).results;
  const actions = (await statement(db, `SELECT action, revision_id AS revisionId,
    occurred_at AS occurredAt, note FROM owner_actions WHERE edition_id = ? ORDER BY id`, id)
    .all<{ action: string; revisionId: string; occurredAt: string; note: string | null }>()).results;
  const version = async (revisionId: string | null) => {
    const revision = revisions.find((row) => row.id === revisionId);
    if (!revision) return null;
    const stages = (await statement(db, "SELECT facts FROM stages WHERE revision_id = ? ORDER BY position",
      revision.id).all<{ facts: string }>()).results.map(({ facts }) => JSON.parse(facts) as EventStage);
    return { revisionId: revision.id,
      facts: JSON.parse(revision.snapshot) as Omit<Opportunity, "publication" | "firstImportedAt">, stages };
  };
  return { ...edition, approved: await version(edition.approvedId), pending: await version(edition.pendingId),
    history: revisions.map(({ snapshot, ...row }) => row),
    sources: sources.map((row) => ({ ...row, observation: JSON.parse(row.observation) })), actions };
}

export async function decideRevision(
  db: Database, action: "publish" | "reject", editionId: string, revisionId: string,
  note: string | null = null, now = new Date(),
) {
  const stamp = now.toISOString();
  const outcome = action === "publish" ? "approved" : "rejected";
  const [decided] = await db.batch([
    statement(db, `UPDATE edition_revisions SET review_state = ?, decided_at = ?, decision_note = ?
      WHERE edition_id = ? AND id = ? AND review_state = 'pending'
        AND EXISTS (SELECT 1 FROM editions WHERE id = ? AND pending_revision_id = ?)`,
    outcome, stamp, note, editionId, revisionId, editionId, revisionId),
    statement(db, `INSERT INTO owner_actions (edition_id, revision_id, action, occurred_at, note)
      SELECT ?, ?, ?, ?, ? WHERE changes() = 1`, editionId, revisionId, action, stamp, note),
    statement(db, `UPDATE editions SET pending_revision_id = NULL,
      publication_state = CASE WHEN ? = 'publish' THEN 'published'
        WHEN publication_state = 'draft' THEN 'rejected' ELSE publication_state END,
      approved_revision_id = CASE WHEN ? = 'publish' THEN ? ELSE approved_revision_id END
      WHERE id = ? AND pending_revision_id = ? AND changes() = 1`,
    action, action, revisionId, editionId, revisionId),
  ]);
  if (decided?.meta.changes !== 1) {
    throw new Error("No matching pending revision. Inspect the edition again before deciding.");
  }
}

export async function withdrawEdition(db: Database, id: string, note: string, now = new Date()) {
  if (!note.trim()) throw new Error("A withdrawal reason is required.");
  const [result] = await db.batch([
    statement(db, "UPDATE editions SET publication_state = 'withdrawn' WHERE id = ? AND publication_state = 'published'", id),
    statement(db, `INSERT INTO owner_actions (edition_id, revision_id, action, occurred_at, note)
      SELECT id, approved_revision_id, 'withdraw', ?, ? FROM editions WHERE id = ? AND changes() = 1`,
    now.toISOString(), note.trim(), id),
  ]);
  if (result?.meta.changes !== 1) throw new Error(`No published edition to withdraw: ${id}`);
}
