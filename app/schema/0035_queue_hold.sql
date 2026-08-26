-- "Hold": the tool found a reason NOT to apply to something already on Ben's
-- To-Apply list. It is deliberately NOT a skip. Skip removes a row from the
-- worklist; hold leaves it there, flagged, with the reason visible, because the
-- decision to drop something Ben put on his own list is his to make.
ALTER TABLE apply_queue ADD COLUMN hold_reason TEXT;
ALTER TABLE apply_queue ADD COLUMN hold_detail TEXT;
ALTER TABLE apply_queue ADD COLUMN held_by TEXT;      -- 'agent' | 'user'
ALTER TABLE apply_queue ADD COLUMN held_at TEXT;
