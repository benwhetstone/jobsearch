-- 0030: structured skip reasons on the To-Apply queue.
--
-- An agent may skip a row ONLY with a reason from a fixed enum plus a detail
-- string. That keeps the original protection (nothing leaves the worklist
-- silently) while making the queue's dead ends legible: a `gated` row is one
-- sign-in away from submittable and worth reviving, a `dead` row never is.
-- Prose notes flattened that distinction the moment they scrolled out of view.
ALTER TABLE apply_queue ADD COLUMN skip_reason TEXT;   -- dead|closed|gated|screened_out|off_target|duplicate
ALTER TABLE apply_queue ADD COLUMN skip_detail TEXT;   -- why, in the agent's own words
ALTER TABLE apply_queue ADD COLUMN skipped_by  TEXT;   -- 'agent' | 'user'
ALTER TABLE apply_queue ADD COLUMN skipped_at  TEXT;   -- ISO8601

CREATE INDEX IF NOT EXISTS idx_queue_skip_reason ON apply_queue(user_id, status, skip_reason);
