-- 0026: a per-job activity log (timeline) + document links.
--
-- The activity_log is the append-only story of a job: queued, tailored, gate
-- verdict, applied, status changes, notes Cowork leaves as it works, emails the
-- Gmail scan matched, errors. Anything can write to it; the UI shows it per job.
-- An event can point at an application, a queue row, or just a company+title
-- key (so the timeline survives before an application row exists).
CREATE TABLE IF NOT EXISTS activity_log (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  application_uuid TEXT,            -- FK-ish to applications_v2.uuid (nullable)
  queue_id         TEXT,            -- FK-ish to apply_queue.id (nullable)
  job_key          TEXT,           -- lower(company)|lower(title) fallback key
  kind             TEXT NOT NULL,   -- queued|tailored|gate|applied|status|note|email|error|apply
  message          TEXT NOT NULL,   -- human-readable line
  meta_json        TEXT,            -- optional structured extras
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_app   ON activity_log(application_uuid, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_queue ON activity_log(queue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_key   ON activity_log(user_id, job_key, created_at);

-- Where the generated résumé / cover letter live (Google Drive links). Cowork
-- writes these when it saves the tailored docs; the site links to them.
ALTER TABLE applications_v2 ADD COLUMN resume_url TEXT;
ALTER TABLE applications_v2 ADD COLUMN cover_url  TEXT;
ALTER TABLE apply_queue     ADD COLUMN resume_url TEXT;
ALTER TABLE apply_queue     ADD COLUMN cover_url  TEXT;
