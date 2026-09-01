-- 0025: richer queue rows — salary + description so cards show more and the
-- score can be computed with real posting text (not just a bare title).
ALTER TABLE apply_queue ADD COLUMN salary_min REAL;
ALTER TABLE apply_queue ADD COLUMN salary_max REAL;
ALTER TABLE apply_queue ADD COLUMN description TEXT;
