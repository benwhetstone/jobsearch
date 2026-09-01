-- Phase 2: job ingest + match. Query-driven, industry-agnostic.
-- jobs are global (deduped across sources); matches + search_prefs are per-user.
-- Idempotent.

CREATE TABLE IF NOT EXISTS search_prefs (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  keywords    TEXT,                     -- free text; falls back to desired titles from the profile
  location    TEXT,                     -- city/region; blank = anywhere
  remote_only INTEGER NOT NULL DEFAULT 0,
  salary_min  INTEGER,                  -- overrides the profile floor for search if set
  radius_mi   INTEGER,                  -- search radius around location, in miles (blank = board default)
  country     TEXT NOT NULL DEFAULT 'us',
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  uuid            TEXT PRIMARY KEY,      -- source + ':' + external id
  source          TEXT NOT NULL,        -- adzuna | remotive | themuse | ...
  external_id     TEXT,
  title           TEXT NOT NULL,
  company_name    TEXT,
  location        TEXT,
  remote          INTEGER NOT NULL DEFAULT 0,
  salary_min      REAL,
  salary_max      REAL,
  salary_currency TEXT,
  url             TEXT NOT NULL,        -- posting URL
  apply_url       TEXT,
  board           TEXT,                 -- greenhouse|lever|workable|ashby|... (from apply/url)
  category        TEXT,
  description     TEXT,
  posted_at       TEXT,
  scam_score      INTEGER NOT NULL DEFAULT 0,
  dedupe_key      TEXT,                 -- normalize(company)+normalize(title)+location
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

CREATE TABLE IF NOT EXISTS matches (
  user_id      TEXT NOT NULL REFERENCES users(id),
  job_uuid     TEXT NOT NULL REFERENCES jobs(uuid),
  total_score  REAL NOT NULL DEFAULT 0,
  skills       REAL, experience REAL, compensation REAL, terms REAL, company REAL,
  comp_flag    TEXT,                    -- ok | negotiation | dropped | undisclosed
  missing_json TEXT,                    -- fields that blocked a confident score
  status       TEXT NOT NULL DEFAULT 'matched',  -- matched | skipped | applied | hidden
  created_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, job_uuid)
);
CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id, status, total_score);
