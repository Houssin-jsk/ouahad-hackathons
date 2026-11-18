CREATE TABLE competitions (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);

-- statement-break
CREATE TABLE editions (
  id TEXT PRIMARY KEY NOT NULL,
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  first_imported_at TEXT NOT NULL,
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_state IN ('draft', 'rejected', 'published', 'withdrawn')),
  approved_revision_id TEXT,
  pending_revision_id TEXT,
  last_fingerprint TEXT,
  CHECK (publication_state <> 'published' OR approved_revision_id IS NOT NULL),
  FOREIGN KEY (id, approved_revision_id) REFERENCES edition_revisions(edition_id, id),
  FOREIGN KEY (id, pending_revision_id) REFERENCES edition_revisions(edition_id, id)
);

-- statement-break
CREATE TABLE edition_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL REFERENCES editions(id),
  fingerprint TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  review_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'approved', 'rejected', 'superseded')),
  decided_at TEXT,
  decision_note TEXT,
  UNIQUE (edition_id, id)
);

-- statement-break
CREATE TABLE stages (
  revision_id TEXT NOT NULL REFERENCES edition_revisions(id),
  stage_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT,
  entry_method TEXT NOT NULL CHECK (entry_method IN ('direct', 'advancement')),
  requires_stage_key TEXT,
  facts TEXT NOT NULL CHECK (json_valid(facts)),
  PRIMARY KEY (revision_id, stage_key),
  UNIQUE (revision_id, position),
  FOREIGN KEY (revision_id, requires_stage_key) REFERENCES stages(revision_id, stage_key),
  CHECK ((entry_method = 'direct' AND requires_stage_key IS NULL)
    OR (entry_method = 'advancement' AND requires_stage_key IS NOT NULL))
);

-- statement-break
CREATE TABLE source_evidence (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  edition_id TEXT REFERENCES editions(id),
  source_url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  observation TEXT NOT NULL CHECK (json_valid(observation)),
  PRIMARY KEY (source, external_id)
);

-- statement-break
CREATE INDEX source_evidence_edition ON source_evidence (edition_id);

-- statement-break
CREATE INDEX editions_publication ON editions (publication_state);

-- statement-break
CREATE TABLE source_health (
  source TEXT PRIMARY KEY NOT NULL,
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  error TEXT,
  missing_reviewed_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(missing_reviewed_ids))
);

-- statement-break
CREATE TABLE owner_actions (
  id INTEGER PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id),
  revision_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('publish', 'reject', 'withdraw')),
  occurred_at TEXT NOT NULL,
  note TEXT,
  FOREIGN KEY (edition_id, revision_id) REFERENCES edition_revisions(edition_id, id)
);
