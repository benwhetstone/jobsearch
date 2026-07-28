-- 0018: ats_job_id on jobs (direct-link rewrite stores the posting id)
ALTER TABLE jobs ADD COLUMN ats_job_id TEXT;
