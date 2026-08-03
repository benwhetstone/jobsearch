-- 0024: carry the match score on queued jobs so it follows them from the feed
-- through the To-Apply worklist, and so Cowork-surfaced jobs show the same
-- authoritative score the site computes.
ALTER TABLE apply_queue ADD COLUMN match_score REAL;
