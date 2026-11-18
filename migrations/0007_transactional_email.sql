ALTER TABLE email_signin_challenges ADD COLUMN transport TEXT NOT NULL DEFAULT 'capture' CHECK (transport IN ('capture','resend'));
-- statement-break
CREATE TABLE live_email_identities (
  email TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES private_users(id) CHECK (user_id GLOB 'usr_*'),
  verified_at TEXT NOT NULL
);
-- statement-break
CREATE TABLE email_reminder_settings_v7 (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES private_users(id),
  reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminders_enabled IN (0,1)),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','fr','ar')),
  delivery_email TEXT, verified_at TEXT,
  verification_kind TEXT CHECK (verification_kind IS NULL OR verification_kind IN ('captured-local','mailbox-code')),
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
-- statement-break
INSERT INTO email_reminder_settings_v7 SELECT * FROM email_reminder_settings;
-- statement-break
DROP TABLE email_reminder_settings;
-- statement-break
ALTER TABLE email_reminder_settings_v7 RENAME TO email_reminder_settings;
-- statement-break
CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('signin','reminder-address','reminder')),
  user_id TEXT REFERENCES private_users(id),
  challenge_id TEXT,
  reminder_id TEXT,
  generation INTEGER,
  encrypted_payload TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','retry_wait','quota_wait','provider_accepted','cancelled','failed','unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  uncertain INTEGER NOT NULL DEFAULT 0 CHECK (uncertain IN (0,1)),
  next_attempt_at TEXT NOT NULL,
  first_attempt_at TEXT,
  expires_at TEXT NOT NULL,
  provider_id TEXT,
  accepted_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement-break
CREATE INDEX email_deliveries_due ON email_deliveries(state,next_attempt_at,kind);
-- statement-break
CREATE INDEX email_deliveries_owner ON email_deliveries(user_id,created_at);
-- statement-break
CREATE TABLE email_budget_reservations (
  delivery_id TEXT NOT NULL REFERENCES email_deliveries(id),
  bucket TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('codes','reminders')),
  PRIMARY KEY(delivery_id,bucket)
);
-- statement-break
CREATE TABLE email_transport_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  owner TEXT, lease_until TEXT, next_request_at TEXT,
  blocked_until TEXT, blocked_reason TEXT
);
-- statement-break
INSERT INTO email_transport_state(id) VALUES(1);
