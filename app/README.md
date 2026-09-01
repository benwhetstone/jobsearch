# Job Search Engine (jobs.benwhetstone.info)

Ben's personal job-search tooling, rebuilt on the globalwork.ai architecture:
a **structured data model instead of prompts**, running on the Cloudflare stack
he already pays for (Pages + Functions + D1). Single user, bearer-token auth, no
billing, no growth stack.

Full spec: `../PROJECT-BRIEF.md` (the globalwork teardown). This directory is
**Phase 1 — the Profile engine**, which everything else depends on.

## What "autopilot" means here

Apply is **per-job and human-initiated**. When Ben clicks Apply on a matched
role, autopilot does the prep — tailors the resume, runs the hiring-manager
gate, mirrors the ATS form and prefills it from the profile — and then **stops
for Ben's approval**. It never submits on its own. Matches repopulate on the
first login of the day.

## Multi-tenant

Ben can bring friends and family onto the same app. Each person gets their own
account (email + password) and their own private profile; the field *definitions*
are shared, the *values* are per-user. Passwords are PBKDF2-hashed in D1, sessions
are HttpOnly cookies. Ben's pre-filled profile is a **claimable** account: the
first sign-up with `brwhetstone@gmail.com` sets his password and inherits the
seeded profile. Optional `APP_SIGNUP_CODE` makes sign-up invite-only.

## Email notifications

When a user needs to log in and do something (new matches, an application that
needs an answer, an interview reply), later phases insert an `action_item`. A
daily Cron Trigger calls `POST /api/v1/notifications/run` (admin-token guarded),
which emails everyone with pending items via Resend. Email degrades to a no-op
until `RESEND_API_KEY` is set, so the app runs before email is wired up.

## Phase 1: the Profile engine

The highest-value idea in the whole product. The profile is modeled as a table
of field *definitions* plus a table of field *values*, not as columns on a users
table. Each field row carries the plain-English `question` it answers, so the
same row drives the profile form label, the match-score input, and the ATS
answer lookup. Add a field once, it works everywhere.

Their `isMatchingParam` flag is misnamed (it flags `firstName`/`lastName`), so we
split it into two honest booleans: `is_required` and `is_matching_input`.

### Layout

```
app/
  wrangler.toml                 Pages + D1 binding (reuses bens-job-search-db)
  package.json                  deploy + migrate scripts
  schema/
    0001_profile_engine.sql     profile_blocks, profile_fields, profile_values, profile_field_aliases
    0002_seed_blocks_fields.sql 6 blocks + 71 curated fields (from the DCP taxonomy)
    0003_seed_ben_values.sql    Ben's values (constraints encoded here, not in prompt)
  functions/api/                Pages Functions (bearer-guarded)
    _middleware.ts              auth + CORS
    v1/health.ts                GET /api/v1/health
    v1/profile/index.ts         GET /api/v1/profile         (blocks -> categories -> fields + values)
    v1/profile/values.ts        PATCH /api/v1/profile/values (upsert, enum-validated)
    v1/profile/completion.ts    GET /api/v1/profile/completion
  lib/match.ts                  scoring formula + band copy, ready for Phase 2
  public/                       the block editor (question-as-label, completion bars, autosave)
```

### Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET  | `/api/v1/health` | none | liveness + field count |
| POST | `/api/v1/auth/signup` | none | `{ email, password, name?, inviteCode? }` → creates/claims account, sets session cookie |
| POST | `/api/v1/auth/login` | none | `{ email, password }` → sets session cookie |
| POST | `/api/v1/auth/logout` | cookie | clears the session |
| GET  | `/api/v1/auth/me` | none | current user or `{ user: null }` |
| GET  | `/api/v1/profile` | cookie | whole profile: blocks, categories, fields, this user's values, completion |
| PATCH| `/api/v1/profile/values` | cookie | upsert values. `{ values: [{ fieldKey, value }] }`. Enum-validated. `null`/`""`/`[]` clears |
| GET  | `/api/v1/profile/completion` | cookie | `{ score, requiredScore, blocks: {...} }` |
| GET  | `/api/v1/actions` | cookie | this user's pending action items |
| POST | `/api/v1/actions` | cookie | create an action item `{ kind, title, detail?, url? }` |
| PATCH| `/api/v1/actions` | cookie | resolve one `{ id, status: 'done'\|'dismissed' }` |
| POST | `/api/v1/notifications/run` | admin bearer | daily digest: emails users with pending items |

All list responses use the `{ data, meta }` envelope.

## Deploy

Prereqs: `npm install`, and `wrangler` authenticated to the account that owns
`bens-job-search-db`.

```bash
cd app
npm install

# 1. Create the tables and seed Ben's profile on the REMOTE D1
npm run db:setup          # runs 0001, 0002, 0003 against --remote

# 2. Set the admin token used by the daily notifications cron (do NOT commit it)
npx wrangler pages secret put APP_ADMIN_TOKEN --project-name jobs-benwhetstone
#   optional: npx wrangler pages secret put APP_SIGNUP_CODE  (invite-only sign-up)
#   optional: npx wrangler pages secret put RESEND_API_KEY   (enables email)

# 3. Deploy the Pages project (Functions ship with it)
npm run deploy

# 4. Point jobs.benwhetstone.info at the Pages project in the Cloudflare dashboard
```

### Daily notifications cron

Pages Functions don't run on a schedule, so add a tiny Cron Trigger (a Worker, or
any scheduler) that once a day sends:

```
POST https://jobs.benwhetstone.info/api/v1/notifications/run
Authorization: Bearer <APP_ADMIN_TOKEN>
```

That emails every user who has pending action items.

Local dev against a local copy of the DB:

```bash
npm run db:setup:local
npm run dev               # wrangler pages dev, serves public/ + functions/
```

Open the app, paste the token, and edit the profile. Changes autosave; enum
answers are validated server-side so matching stays deterministic.

## Constraints encoded in the data (not in prompt)

These live in `schema/0003_seed_ben_values.sql` and are enforced by enum
validation in the API:

- First name on applications: **Benjamin**.
- Address: **6514 Maiden Sea Dr, Apollo Beach, FL 33572** (not Riverview).
- Salary floor: **$60K** (`baseSalary`). Phase 2's compensation ranker drops
  jobs under $54K and flags $54–60K.
- **Protected veteran: YES. Disability: YES.**
- **Race / ethnicity: intentionally left blank** so the system never
  auto-answers it. Ben decides per application.
- Skills (`technicalToolbox`, `st_hardSkills`) are the approved set only. No AI,
  no Lofty / SkySlope / CRM / Google Ads. The match vocabulary is separate from
  the fixed resume allowlist.
- Closing Day is a **sales pipeline analytics platform**; SST is **$36M annual**
  transaction volume.

## Roadmap (later phases, per the brief)

2. Job ingest + the five-ranker match pipeline (`lib/match.ts` is ready).
3. Documents: tailored CVs keyed to a job, redline diff, `verify_resume.py` gate.
4. ATS form mirror + the 5-step fill algorithm (enum coercion is the differentiator).
5. Relay inbox (per-application addresses on `jobs.benwhetstone.info`).
6. Analytics: funnel with benchmarks, activity, salary alignment, ranker calibration.
