-- 0023: standards / rules — the résumé + cover-letter standards and best
-- practices, moved out of Google Drive docs into structured D1 so the app
-- (resume-builder, hiring-manager gate) can READ and ENFORCE them, and so
-- they're available to every session, not just ones with the Drive mount.
-- value_json holds the structured rules; raw_source keeps the original doc
-- text for reference / human editing.
CREATE TABLE IF NOT EXISTS standards (
  user_id    TEXT NOT NULL REFERENCES users(id),
  key        TEXT NOT NULL,          -- 'resume' | 'cover_letter' | 'general'
  value_json TEXT NOT NULL,          -- { format, content, contact, voiceNotes }
  raw_source TEXT,                   -- the original doc text, for reference
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
