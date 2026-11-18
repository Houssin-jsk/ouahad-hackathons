ALTER TABLE email_signin_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'signin'
  CHECK (purpose IN ('signin','reminder-address'));
-- statement-break
ALTER TABLE email_signin_challenges ADD COLUMN account_id TEXT REFERENCES private_users(id);
-- statement-break
CREATE TABLE email_reminder_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES private_users(id),
  reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminders_enabled IN (0,1)),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','fr','ar')),
  delivery_email TEXT,
  verified_at TEXT,
  verification_kind TEXT CHECK (verification_kind IS NULL OR verification_kind = 'captured-local'),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
-- statement-break
CREATE TABLE stage_reminders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES private_users(id),
  entry_id TEXT NOT NULL,
  stage_key TEXT NOT NULL,
  schedule_hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reminder','schedule-change')),
  due_at TEXT,
  expires_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','cancelled','captured','waiting')),
  reason TEXT,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  guard TEXT NOT NULL CHECK (json_valid(guard)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id,entry_id,stage_key),
  FOREIGN KEY (entry_id,user_id) REFERENCES private_entries(id,user_id)
);
-- statement-break
CREATE INDEX stage_reminders_due ON stage_reminders(state,due_at);
-- statement-break
CREATE INDEX stage_reminders_owner ON stage_reminders(user_id,entry_id);
-- statement-break
CREATE TABLE reminder_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  reminder_id TEXT NOT NULL REFERENCES stage_reminders(id),
  generation INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES private_users(id),
  kind TEXT NOT NULL CHECK (kind IN ('reminder','schedule-change')),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en','fr','ar')),
  captured_at TEXT NOT NULL,
  UNIQUE (reminder_id,generation)
);
-- statement-break
CREATE INDEX reminder_outbox_owner ON reminder_outbox(user_id,captured_at);
