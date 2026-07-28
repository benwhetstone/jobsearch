-- Phase 1: Profile engine schema.
-- Source: PROJECT-BRIEF §3.2. Models the profile as field DEFINITIONS + field
-- VALUES, not as columns on a users table. The `question` on each field row
-- drives three things at once: the profile form label, the match-score input,
-- and the ATS answer lookup.
--
-- Single user (Ben). No users table, no tenant column: every value row is his.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS profile_blocks (
  key         TEXT PRIMARY KEY,          -- personalDetails | workEligibility | ...
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_fields (
  field_key         TEXT PRIMARY KEY,
  block_key         TEXT NOT NULL REFERENCES profile_blocks(key),
  category_key      TEXT NOT NULL,                        -- UI tab within the block
  category_label    TEXT,                                 -- human label for the tab
  field_type        TEXT NOT NULL,                        -- string|number|boolean|string_array|object_array
  question          TEXT,                                 -- plain English label. NULLABLE (7/92 are null upstream)
  options_json      TEXT NOT NULL DEFAULT '[]',           -- controlled enum, [] for free text
  is_multi_select   INTEGER NOT NULL DEFAULT 0,
  -- Their `isMatchingParam` flag is misnamed. We split it into two honest booleans:
  is_required       INTEGER NOT NULL DEFAULT 0,           -- must be filled for the profile to be usable
  is_matching_input INTEGER NOT NULL DEFAULT 0,           -- actually read by a ranker in the match pipeline
  storage_target    TEXT NOT NULL DEFAULT 'FIELD_VALUE',
  help_text         TEXT,
  sort_order        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fields_block ON profile_fields(block_key, sort_order);

CREATE TABLE IF NOT EXISTS profile_values (
  field_key  TEXT PRIMARY KEY REFERENCES profile_fields(field_key),
  value_json TEXT,                                        -- always JSON, even scalars
  updated_at TEXT NOT NULL
);

-- Aliases so an ATS question can resolve to a field without an LLM call.
-- OUR addition (not in globalwork). Every time a human resolves an unmatched
-- ATS question, write the normalized question text here as a 'learned' alias.
CREATE TABLE IF NOT EXISTS profile_field_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  field_key  TEXT NOT NULL REFERENCES profile_fields(field_key),
  alias_text TEXT NOT NULL,                               -- normalized employer question text
  source     TEXT NOT NULL,                               -- 'seed' | 'learned'
  hit_count  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alias_text ON profile_field_aliases(alias_text);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_unique ON profile_field_aliases(field_key, alias_text);
