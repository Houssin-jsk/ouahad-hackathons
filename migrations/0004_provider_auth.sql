-- Rebuild the private tables atomically. Keep every demo owner and record unchanged.
CREATE TABLE private_users_next (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('demo','provider')),
  CHECK ((kind = 'demo' AND id IN ('dev-aya','dev-sami')) OR (kind = 'provider' AND id GLOB 'usr_*'))
);
-- statement-break
INSERT INTO private_users_next (id, name, kind) SELECT id, name, 'demo' FROM private_users;
-- statement-break
CREATE TABLE private_sessions_next (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES private_users_next(id),
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  realm TEXT NOT NULL DEFAULT 'demo'
);
-- statement-break
INSERT INTO private_sessions_next (token_hash, user_id, csrf, expires_at)
  SELECT token_hash, user_id, csrf, expires_at FROM private_sessions;
-- statement-break
CREATE TABLE private_entries_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES private_users_next(id),
  catalog_id TEXT REFERENCES editions(id),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, catalog_id), UNIQUE (id, user_id)
);
-- statement-break
INSERT INTO private_entries_next SELECT * FROM private_entries;
-- statement-break
CREATE TABLE private_stage_progress_next (
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  facts TEXT NOT NULL CHECK (json_valid(facts)),
  application TEXT NOT NULL DEFAULT 'not-submitted' CHECK (application IN ('not-submitted','submitted')),
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  intent TEXT NOT NULL DEFAULT 'undecided' CHECK (intent IN ('undecided','going','declined')),
  attended INTEGER NOT NULL DEFAULT 0 CHECK (attended IN (0,1)),
  result TEXT NOT NULL DEFAULT 'none' CHECK (result IN ('none','advanced','placed','won')),
  PRIMARY KEY (entry_id, stage_key),
  FOREIGN KEY (entry_id, user_id) REFERENCES private_entries_next(id, user_id)
);
-- statement-break
INSERT INTO private_stage_progress_next SELECT * FROM private_stage_progress;
-- statement-break
DROP TABLE private_stage_progress;
-- statement-break
DROP TABLE private_sessions;
-- statement-break
DROP TABLE private_entries;
-- statement-break
DROP TABLE private_users;
-- statement-break
ALTER TABLE private_users_next RENAME TO private_users;
-- statement-break
ALTER TABLE private_entries_next RENAME TO private_entries;
-- statement-break
ALTER TABLE private_sessions_next RENAME TO private_sessions;
-- statement-break
ALTER TABLE private_stage_progress_next RENAME TO private_stage_progress;
-- statement-break
CREATE INDEX private_entries_owner ON private_entries (user_id, created_at);
-- statement-break
CREATE TABLE provider_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES private_users(id) CHECK (user_id GLOB 'usr_*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (issuer, subject)
);
-- statement-break
CREATE TABLE auth_transactions (
  state_hash TEXT PRIMARY KEY NOT NULL,
  browser_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL REFERENCES private_sessions(token_hash) ON DELETE CASCADE,
  realm TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
-- statement-break
CREATE INDEX private_sessions_expiry ON private_sessions (expires_at);
-- statement-break
CREATE INDEX auth_transactions_expiry ON auth_transactions (expires_at);
-- statement-break
CREATE INDEX auth_transactions_session ON auth_transactions (session_hash);
