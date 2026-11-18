CREATE TABLE private_users (
  id TEXT PRIMARY KEY NOT NULL CHECK (id IN ('dev-aya', 'dev-sami')),
  name TEXT NOT NULL
);

-- statement-break
CREATE TABLE private_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES private_users(id),
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- statement-break
CREATE TABLE private_entries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES private_users(id),
  catalog_id TEXT REFERENCES editions(id),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, catalog_id),
  UNIQUE (id, user_id)
);

-- statement-break
CREATE TABLE private_stage_progress (
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
  FOREIGN KEY (entry_id, user_id) REFERENCES private_entries(id, user_id)
);

-- statement-break
CREATE INDEX private_entries_owner ON private_entries (user_id, created_at);
