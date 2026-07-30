-- 0021: per-user OAuth credentials for reading external mail (Gmail).
-- Not exposed through the profile API — client secret and refresh token stay
-- server-side. The refresh sweep uses these to scan the user's mailbox and
-- keep the application tracker current from outside applications + updates.
CREATE TABLE IF NOT EXISTS oauth_credentials (
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL,                 -- 'gmail'
  client_id     TEXT,
  client_secret TEXT,
  refresh_token TEXT,                          -- the long-lived grant
  email         TEXT,                          -- the connected address
  status        TEXT NOT NULL DEFAULT 'unconfigured', -- unconfigured | configured | connected | error
  last_scan_at  TEXT,
  last_history_id TEXT,                        -- Gmail historyId cursor for incremental scans
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
