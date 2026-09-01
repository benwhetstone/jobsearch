-- 0027: canonical job identity (job_id).
--
-- One real-world posting -> one job_id, carried from the feed through the queue
-- into the application. Same requisition from a different board resolves to the
-- SAME job_id (ATS-anchored) instead of a new per-source uuid, so "not
-- interested" and "already applied" become exact-key checks instead of fuzzy
-- company+title+location matching (which over-collapsed and hid real openings).
-- Schema + generation live in functions/api/_jobid.ts; see POST /api/v1/job-id.
ALTER TABLE jobs            ADD COLUMN job_id TEXT;
ALTER TABLE apply_queue     ADD COLUMN job_id TEXT;
ALTER TABLE applications_v2 ADD COLUMN job_id TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_job_id  ON jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_queue_job_id ON apply_queue(job_id);
CREATE INDEX IF NOT EXISTS idx_apps_job_id  ON applications_v2(job_id);
