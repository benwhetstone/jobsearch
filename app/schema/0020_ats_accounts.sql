-- 0020: per-tenant ATS candidate accounts (Workday/iCIMS create an account
-- before you can apply). The worker creates one using the vanity relay email,
-- verifies it via the link that lands in the relay inbox, and reuses it for
-- every future application to that same ATS tenant.
CREATE TABLE IF NOT EXISTS ats_accounts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  ats          TEXT NOT NULL,           -- workday | icims | ...
  tenant       TEXT NOT NULL,           -- workday tenant host, e.g. gdit.wd1.myworkdayjobs.com
  email        TEXT NOT NULL,           -- the vanity relay address used to register
  password     TEXT NOT NULL,           -- generated; TODO encrypt at rest (D1 is private for now)
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | failed
  created_at   TEXT NOT NULL,
  verified_at  TEXT,
  UNIQUE (user_id, ats, tenant)
);
