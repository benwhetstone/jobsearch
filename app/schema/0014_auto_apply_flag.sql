-- 0014: jobs learn whether autopilot can file them directly (globalwork's
-- hasModernAutoApply, resolved at sweep time instead of at click time).
-- auto_apply: NULL = not checked yet, 1 = company board resolved to a
-- supported ATS, 0 = checked and not resolvable (manual apply).
ALTER TABLE jobs ADD COLUMN auto_apply INTEGER;
ALTER TABLE jobs ADD COLUMN ats TEXT;
ALTER TABLE jobs ADD COLUMN ats_token TEXT;
