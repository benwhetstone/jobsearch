-- 0029: per-user Cowork run state.
--
-- last_run_at lets Cowork window each board query off elapsed-since-last-run
-- instead of a fixed 24h (fixed windows double-read same-day reruns and skip
-- gaps). new_employers is the per-run count of employers newly added to the
-- Layer-1 ATS maps — the measurable "are we still discovering?" signal.
CREATE TABLE IF NOT EXISTS cowork_state (
  user_id       TEXT PRIMARY KEY,
  last_run_at   TEXT,
  new_employers INTEGER DEFAULT 0,
  updated_at    TEXT
);
