-- Phase 3/4: the apply pipeline. Clicking Apply starts autopilot — tailor the
-- documents, mirror the employer's real form, prefill it, and stop for approval.
-- Nothing here submits anything on its own.
-- Idempotent.

-- Company -> applicant tracking system. Rows with ats IS NULL are remembered
-- misses, so we don't re-probe four endpoints for every staffing agency.
CREATE TABLE IF NOT EXISTS ats_boards (
  company_key TEXT PRIMARY KEY,      -- normalized company name
  ats         TEXT,                  -- greenhouse|lever|ashby|workable, NULL = no board found
  token       TEXT,                  -- board token on that ATS
  checked_at  TEXT NOT NULL
);

-- Versioned documents, each keyed to the job it was written for. The base
-- (is_default=1, job_uuid NULL) is what tailored copies diff against.
CREATE TABLE IF NOT EXISTS documents (
  uuid        TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,         -- cv | cover_letter
  doc_type    TEXT NOT NULL,         -- DEFAULT | TAILORED
  is_default  INTEGER NOT NULL DEFAULT 0,
  job_uuid    TEXT REFERENCES jobs(uuid),
  parent_uuid TEXT REFERENCES documents(uuid),   -- exact base revision this came from
  title       TEXT,
  content_json TEXT NOT NULL,        -- structured sections, not prose blob
  verify_passed INTEGER,             -- hard delivery gate result
  verify_report TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, kind, is_default);
CREATE INDEX IF NOT EXISTS idx_documents_job ON documents(user_id, job_uuid);

CREATE TABLE IF NOT EXISTS applications (
  uuid          TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  job_uuid      TEXT NOT NULL REFERENCES jobs(uuid),
  ats           TEXT,                -- resolved ATS, NULL = manual apply
  ats_token     TEXT,
  ats_job_id    TEXT,
  supported_ats INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,       -- preparing|actionRequired|readyToApply|approved|applied|failed
  need_manual_apply INTEGER NOT NULL DEFAULT 0,
  cv_uuid       TEXT REFERENCES documents(uuid),
  cover_letter_uuid TEXT REFERENCES documents(uuid),
  gate_verdict  TEXT,                -- PASS | REVISE | REJECT
  gate_report   TEXT,
  match_score   REAL,
  prepare_error TEXT,
  submitted_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (user_id, job_uuid)
);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id, status, created_at);

-- The employer's form, mirrored field-for-field so it renders natively in our UI.
CREATE TABLE IF NOT EXISTS application_form_fields (
  uuid             TEXT PRIMARY KEY,
  application_uuid TEXT NOT NULL REFERENCES applications(uuid),
  field_key        TEXT NOT NULL,
  field_type       TEXT NOT NULL,
  label            TEXT NOT NULL,    -- employer's verbatim question
  label_normalized TEXT NOT NULL,
  value            TEXT,
  options_json     TEXT NOT NULL DEFAULT '[]',
  required         INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL,
  fill_source      TEXT,             -- profile:<fieldKey> | alias | enum | llm | human
  fill_status      TEXT NOT NULL,    -- filled | needs_human | skipped
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_fields_app ON application_form_fields(application_uuid, sort_order);

-- Remembers the last automatic daily sweep so matches are waiting at first login.
CREATE TABLE IF NOT EXISTS daily_sweeps (
  user_id   TEXT NOT NULL REFERENCES users(id),
  sweep_day TEXT NOT NULL,           -- YYYY-MM-DD
  found     INTEGER NOT NULL DEFAULT 0,
  ran_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, sweep_day)
);

-- Per-user writing rules. These MUST NOT be global: "$36 million is annual
-- transaction volume" is true for Ben and meaningless for anyone else. Universal
-- rules (never invent an employer, never claim an unlisted skill) live in code;
-- everything tenant-specific lives here.
CREATE TABLE IF NOT EXISTS writing_rules (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL REFERENCES users(id),
  pattern   TEXT NOT NULL,           -- JS regex source, tested against the document text
  requires  TEXT,                    -- if set, pattern is only OK when this also matches
  forbids   INTEGER NOT NULL DEFAULT 0,  -- 1 = matching the pattern is itself a violation
  message   TEXT NOT NULL,
  severity  TEXT NOT NULL DEFAULT 'fail',  -- fail (blocks delivery) | warn
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_writing_rules_user ON writing_rules(user_id);

-- Résumé / cover letter look. Ben's existing design spec is one of four.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  resume_template TEXT NOT NULL DEFAULT 'classic',
  auto_sweep     INTEGER NOT NULL DEFAULT 1,   -- surface matches on first login of the day
  updated_at     TEXT
);
