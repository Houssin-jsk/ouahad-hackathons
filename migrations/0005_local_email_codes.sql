-- Local captured delivery only. The production Worker cannot enable this transport.
CREATE TABLE email_identities (
  email TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES private_users(id) CHECK (user_id GLOB 'usr_*'),
  verified_at TEXT NOT NULL
);
-- statement-break
CREATE TABLE email_signin_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  session_hash TEXT NOT NULL REFERENCES private_sessions(token_hash) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  return_path TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
-- statement-break
CREATE INDEX email_challenges_session ON email_signin_challenges(session_hash);
-- statement-break
CREATE TABLE local_email_outbox (
  challenge_id TEXT PRIMARY KEY NOT NULL REFERENCES email_signin_challenges(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- statement-break
CREATE TABLE email_request_limits (
  key TEXT PRIMARY KEY NOT NULL,
  window_start TEXT NOT NULL,
  last_sent TEXT NOT NULL,
  count INTEGER NOT NULL
);
