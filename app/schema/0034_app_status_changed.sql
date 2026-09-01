-- When an application last CHANGED STAGE — distinct from updated_at, which any
-- edit bumps (attaching docs, a prepare error). The Rejected list is meant to
-- read most-recent-rejection first, and created_at (the old sort) is the date
-- the application was STARTED, which is unrelated.
ALTER TABLE applications_v2 ADD COLUMN status_changed_at TEXT;

-- Backfill: the activity log already records each stage move, so recover the
-- real date where it exists. Match only entries naming the CURRENT status, so
-- an app that went interview -> rejected picks up the rejection, not the
-- interview. Fall back to submitted_at, then updated_at, then created_at.
UPDATE applications_v2
   SET status_changed_at = COALESCE(
       (SELECT MAX(al.created_at) FROM activity_log al
         WHERE al.application_uuid = applications_v2.uuid
           AND al.kind IN ('status', 'applied')
           AND al.message LIKE '%' || applications_v2.status || '%'),
       submitted_at, updated_at, created_at)
 WHERE status_changed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_apps_status_changed ON applications_v2(user_id, status_changed_at);
