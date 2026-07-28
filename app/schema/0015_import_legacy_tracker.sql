-- 0015: import the legacy cowork tracker (applications, 13-column table) into
-- the v2 pipeline so the whole search history lives in one funnel.
-- Stage remap: submitted -> applied, rejected -> rejected. Hidden rows stay out.
-- Each legacy row gets a stub jobs record (source 'imported'); rows whose
-- company+title already exist in v2 are skipped, and the UNIQUE(user_id,
-- job_uuid) constraint keeps re-runs harmless.

INSERT INTO jobs (uuid, source, external_id, title, company_name, location, remote,
                  salary_min, salary_max, salary_currency, url, apply_url, board, category,
                  description, posted_at, scam_score, dedupe_key, created_at)
SELECT lower(hex(randomblob(16))), 'imported', 'legacy-' || a.id, a.role, a.company,
       NULL, 0, NULL, NULL, NULL,
       COALESCE(NULLIF(a.url, ''), ''), COALESCE(NULLIF(a.url, ''), ''),
       NULLIF(a.channel, ''), NULL, NULLIF(a.notes, ''), NULLIF(a.date_applied, ''), 0,
       'legacy-' || a.id, COALESCE(NULLIF(a.updated_at, ''), datetime('now'))
FROM applications a
WHERE a.hidden = 0
  AND NOT EXISTS (SELECT 1 FROM jobs jx WHERE jx.external_id = 'legacy-' || a.id AND jx.source = 'imported')
  AND NOT EXISTS (
    SELECT 1 FROM applications_v2 v JOIN jobs j ON j.uuid = v.job_uuid
    WHERE v.user_id = 'user_ben'
      AND lower(j.title) = lower(a.role)
      AND lower(COALESCE(j.company_name, '')) = lower(a.company)
  );

INSERT INTO applications_v2 (uuid, user_id, job_uuid, status, need_manual_apply,
                             submitted_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'user_ben', j.uuid,
       CASE a.status WHEN 'rejected' THEN 'rejected' ELSE 'applied' END,
       1, NULLIF(a.date_applied, ''),
       COALESCE(NULLIF(a.date_applied, ''), datetime('now')), datetime('now')
FROM applications a
JOIN jobs j ON j.external_id = 'legacy-' || a.id AND j.source = 'imported'
WHERE a.hidden = 0
  AND NOT EXISTS (SELECT 1 FROM applications_v2 v WHERE v.user_id = 'user_ben' AND v.job_uuid = j.uuid);
