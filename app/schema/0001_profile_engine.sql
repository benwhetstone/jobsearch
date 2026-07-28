-- Phase 1 schema: multi-tenant profile engine + auth + notifications.
-- Source: PROJECT-BRIEF §3.2, extended to multi-tenant (email+password accounts)
-- so Ben can bring friends and family onto the same app.
--
-- Field DEFINITIONS (blocks, fields) are SHARED across all users: everyone
-- answers the same questions. Field VALUES are per-user. Aliases are global
-- (learned once, they help every user).
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,          -- uuid
  email          TEXT NOT NULL UNIQUE,      -- stored lowercased/trimmed
  name           TEXT,
  password_hash  TEXT,                      -- PBKDF2 hash (hex). NULL = seeded/claimable, no password set yet
  password_salt  TEXT,                      -- per-user salt (hex)
  role           TEXT NOT NULL DEFAULT 'user',   -- user | admin
  notify_email   INTEGER NOT NULL DEFAULT 1,     -- opt-in to action-needed emails
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,             -- random 256-bit hex
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Profile: shared definitions + per-user values
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_blocks (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_fields (
  field_key         TEXT PRIMARY KEY,
  block_key         TEXT NOT NULL REFERENCES profile_blocks(key),
  category_key      TEXT NOT NULL,
  category_label    TEXT,
  field_type        TEXT NOT NULL,          -- string|number|boolean|string_array|object_array
  question          TEXT,                   -- plain English label. NULLABLE
  options_json      TEXT NOT NULL DEFAULT '[]',
  is_multi_select   INTEGER NOT NULL DEFAULT 0,
  is_required       INTEGER NOT NULL DEFAULT 0,
  is_matching_input INTEGER NOT NULL DEFAULT 0,
  storage_target    TEXT NOT NULL DEFAULT 'FIELD_VALUE',
  help_text         TEXT,
  sort_order        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fields_block ON profile_fields(block_key, sort_order);

CREATE TABLE IF NOT EXISTS profile_values (
  user_id    TEXT NOT NULL REFERENCES users(id),
  field_key  TEXT NOT NULL REFERENCES profile_fields(field_key),
  value_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, field_key)
);

-- Aliases so an ATS question can resolve to a field without an LLM call. Global.
CREATE TABLE IF NOT EXISTS profile_field_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  field_key  TEXT NOT NULL REFERENCES profile_fields(field_key),
  alias_text TEXT NOT NULL,
  source     TEXT NOT NULL,                 -- 'seed' | 'learned'
  hit_count  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alias_text ON profile_field_aliases(alias_text);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_unique ON profile_field_aliases(field_key, alias_text);

-- ---------------------------------------------------------------------------
-- Action items + notification log
-- Later phases (match, ATS mirror, relay inbox) INSERT action_items when a user
-- needs to log in and do something. The daily runner emails anyone with pending,
-- un-notified items. notifications_log records what was sent (no double-emailing).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS action_items (
  id          TEXT PRIMARY KEY,             -- uuid
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,                -- e.g. new_matches | action_required | verification_code | interview
  title       TEXT NOT NULL,                -- short line shown to the user
  detail      TEXT,
  url         TEXT,                         -- deep link into the app
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | done | dismissed
  created_at  TEXT NOT NULL,
  notified_at TEXT,                         -- when an email covering this item went out
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_action_user_status ON action_items(user_id, status);

CREATE TABLE IF NOT EXISTS notifications_log (
  id          TEXT PRIMARY KEY,             -- uuid
  user_id     TEXT NOT NULL REFERENCES users(id),
  channel     TEXT NOT NULL DEFAULT 'email',
  subject     TEXT,
  item_count  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL,                -- sent | failed | skipped
  provider_id TEXT,
  error       TEXT,
  sent_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notiflog_user ON notifications_log(user_id, sent_at);
