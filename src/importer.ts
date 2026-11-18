import { normalize, statusAt } from "./model.ts";
import type { Candidate, Opportunity } from "./model.ts";

export type Batch = {
  records: Candidate[];
  needsReview?: { externalId: string; title: string; url: string }[];
  missingReviewedIds?: string[];
  observations?: SourceObservation[];
};
export type SourceObservation = {
  externalId: string;
  source: string;
  feedUrl: string;
  checkedAt: string;
  fields: object;
};
export type Source = { name: string; load: () => Promise<Batch> };
export type Repository = {
  read: () => Promise<Opportunity[]>;
  write: (rows: Opportunity[]) => Promise<void>;
};

export function collectBatches(sources: Source[], now: Date) {
  return Promise.allSettled(sources.map(async (source) => {
    const { records, observations, ...details } = await source.load();
    const staged = new Map<string, Opportunity>();
    for (const record of records) {
      const entry = normalize(record, now.toISOString());
      if (staged.has(entry.id)) throw new Error(`Duplicate source ID: ${entry.id}`);
      staged.set(entry.id, entry);
    }
    return { staged, details, observations };
  }));
}

export async function runImport(repository: Repository, sources: Source[], now = new Date()) {
  const existing = await repository.read();
  const catalog = new Map(existing.map((entry) => [entry.id, entry]));
  const results = await collectBatches(sources, now);

  let changed = false;
  const report = results.map((result, index) => {
    const source = sources[index]!.name;
    if (result.status === "rejected") {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return { source, ok: false as const, error };
    }
    const { staged, details } = result.value;
    let inserted = 0, updated = 0, unchanged = 0;
    for (const [id, entry] of staged) {
      const previous = catalog.get(id);
      if (previous) {
        entry.firstImportedAt = previous.firstImportedAt;
        if (JSON.stringify(entry) === JSON.stringify(previous)) {
          unchanged++;
          continue;
        }
        updated++;
      } else {
        inserted++;
      }
      catalog.set(id, entry);
      changed = true;
    }
    return { source, ok: true as const, inserted, updated, unchanged, ...details };
  });
  if (changed) await repository.write([...catalog.values()]);
  return { totalDrafts: catalog.size, sources: report };
}

export const views = ["all", "open", "archive"] as const;
export function list(rows: Opportunity[], view: typeof views[number], now = new Date()) {
  return rows.map((row) => ({ ...row, effectiveRegistrationStatus: statusAt(row, now) }))
    .filter((row) => view === "all"
      || (view === "archive" && row.effectiveRegistrationStatus === "expired")
      || (view === "open" && row.effectiveRegistrationStatus === "open"
        && row.moroccoEligibility.status === "confirmed"));
}
