-- 0031: the standard card facts.
--
-- Every card (Jobs For You, To-Apply, Applications) shows the same four things
-- in the same order: Pay, Location/arrangement, Experience, Skills. Pay and
-- location already existed; experience and skills did not, so a card could only
-- ever show half the story. These carry from a Cowork suggestion all the way
-- through to the application.
ALTER TABLE jobs        ADD COLUMN experience  TEXT;  -- e.g. "3-5 years", "Senior"
ALTER TABLE jobs        ADD COLUMN skills_json TEXT;  -- JSON array of key skills/tools
ALTER TABLE jobs        ADD COLUMN arrangement TEXT;  -- remote | hybrid | onsite

ALTER TABLE apply_queue ADD COLUMN experience  TEXT;
ALTER TABLE apply_queue ADD COLUMN skills_json TEXT;
ALTER TABLE apply_queue ADD COLUMN arrangement TEXT;
