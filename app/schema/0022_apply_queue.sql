-- 0022: the "To Apply" queue — a durable worklist of jobs we've decided to
-- apply to but haven't yet. Cowork fills this FIRST (so it never forgets what
-- it meant to do when it gets bogged down), then works the queue one by one;
-- each finished item is promoted into applications_v2 to flow through normally.
-- This table is the source of truth for WHAT we intend to apply to.
CREATE TABLE IF NOT EXISTS apply_queue (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  company          TEXT NOT NULL,
  title            TEXT NOT NULL,
  url              TEXT,                       -- the apply / posting link
  location         TEXT,
  notes            TEXT,                       -- why we want it, tailoring hints, etc.
  source           TEXT,                       -- where it came from (feed, gmail, referral…)
  priority         INTEGER NOT NULL DEFAULT 0, -- higher = do sooner
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | applied | skipped
  application_uuid TEXT,                        -- set when promoted into applications_v2
  created_at       TEXT NOT NULL,
  applied_at       TEXT,
  UNIQUE (user_id, company, title)
);
CREATE INDEX IF NOT EXISTS idx_apply_queue_user ON apply_queue(user_id, status, priority DESC, created_at);
