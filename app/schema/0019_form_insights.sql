-- 0019: form-architecture memory. The browser worker records what worked (and
-- what didn't) per ATS + field pattern, then reads it next time so it adapts
-- and never fights the same form architecture twice.
CREATE TABLE IF NOT EXISTS form_insights (
  id           TEXT PRIMARY KEY,
  ats          TEXT,                 -- ashby | greenhouse | lever | workable | workday | generic
  host         TEXT,                 -- form host (jobs.ashbyhq.com, boards.greenhouse.io, …)
  field_kind   TEXT,                 -- file_upload | text | select | typeahead | button_group | date
  strategy     TEXT NOT NULL,        -- what worked, e.g. "drop_event", "label_above", "click_option"
  note         TEXT,
  success      INTEGER NOT NULL DEFAULT 1,
  seen_count   INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL,
  UNIQUE (ats, field_kind, strategy)
);
