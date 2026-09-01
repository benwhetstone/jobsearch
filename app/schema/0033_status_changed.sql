-- 0033: when a match last changed status. Powers suppression visibility: a
-- suppressed suggestion can now say "already skipped 2026-08-20" instead of
-- silently vanishing, and GET /matches?status=skipped can show dismissal dates.
ALTER TABLE matches ADD COLUMN status_changed_at TEXT;
