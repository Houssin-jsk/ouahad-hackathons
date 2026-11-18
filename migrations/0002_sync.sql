CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  started_at TEXT NOT NULL,
  roster_token TEXT NOT NULL
);

-- statement-break
CREATE TABLE sync_source_runs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES sync_runs(id),
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('running', 'success', 'failed', 'skipped-overlap', 'abandoned')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  new_drafts INTEGER NOT NULL DEFAULT 0,
  proposed_changes INTEGER NOT NULL DEFAULT 0,
  unchanged_records INTEGER NOT NULL DEFAULT 0,
  new_candidates INTEGER NOT NULL DEFAULT 0,
  processed_records INTEGER NOT NULL DEFAULT 0,
  UNIQUE (job_id, source)
);

-- statement-break
CREATE INDEX sync_source_history ON sync_source_runs (source, started_at);

-- statement-break
CREATE TABLE sync_leases (
  source TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES sync_source_runs(id),
  expires_at TEXT NOT NULL
);

-- statement-break
CREATE TABLE sync_guards (
  id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

-- statement-break
ALTER TABLE editions ADD COLUMN created_by_run TEXT REFERENCES sync_source_runs(id);

-- statement-break
ALTER TABLE edition_revisions ADD COLUMN source_run_id TEXT REFERENCES sync_source_runs(id);

-- statement-break
ALTER TABLE source_evidence ADD COLUMN first_seen_run TEXT REFERENCES sync_source_runs(id);
