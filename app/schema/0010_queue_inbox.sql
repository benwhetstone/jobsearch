-- Bulk apply queue, relay inbox, AI budget, and the For You / Search split.
-- Idempotent except the ALTERs (guarded by the runner ignoring dup-column errors).

-- Where a match came from: the morning auto-sweep ("Jobs For You") or a manual
-- search. Same engine, two shelves in the UI.
ALTER TABLE matches ADD COLUMN origin TEXT NOT NULL DEFAULT 'auto';

-- Per-application relay address (vanity email): apply+<slug>@ the app domain.
-- Everything sent there lands in the inbox, classified, and linked back here.
ALTER TABLE applications_v2 ADD COLUMN relay_slug TEXT;

-- Inbound email, one row per message. Classified into info | interview | offer
-- | rejection | other; classification also advances the application's status.
CREATE TABLE IF NOT EXISTS inbox_emails (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  application_uuid TEXT REFERENCES applications_v2(uuid),
  relay_slug    TEXT,
  from_addr     TEXT,
  subject       TEXT,
  body_text     TEXT,
  category      TEXT,               -- info | interview | offer | rejection | other
  classified_by TEXT,               -- rules | llm
  received_at   TEXT NOT NULL,
  read_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbox_user ON inbox_emails(user_id, category, received_at);

-- Every model call, logged. The daily cap reads from here: no more silent
-- token burn, and "am I going broke" becomes a query.
CREATE TABLE IF NOT EXISTS ai_usage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT,
  purpose      TEXT NOT NULL,       -- tailor_cv | tailor_cover | gate | form_answer | resume_parse | email_classify | base_resume
  model        TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day ON ai_usage(user_id, created_at);
