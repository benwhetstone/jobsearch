---
name: jobs-api
description: >-
  THE contract for jobs.benwhetstone.info — the single source of truth for auth,
  every endpoint, and the standing rules about who may write what. Read this
  BEFORE any read or write to the job-search site: surfacing candidates, adding
  to To-Apply, changing an application status, logging an application, skipping,
  or recording activity. Every other job-search skill defers to this file rather
  than restating the API, so there is exactly one place that can be right.
  ALWAYS trigger on "jobs api", "job search api", "apply queue", "suggestions",
  "set status", "job_id", or any call to jobs.benwhetstone.info.
---

# jobs.benwhetstone.info — the contract

The site is the **tracker and system of record**. Cowork is **the doer**: it
sweeps, it presents, it applies in the browser, it reports back. The site
remembers. This file is the only place the API is described — if another skill
disagrees with this file, **this file wins** and the other skill is stale.

## Auth — depends on which client you are

There are two ways in. Use the one that matches how you're running; they are not
in conflict, and neither is "the" answer on its own.

**In a browser (Cowork, or Ben's own tab): the session cookie.**
Call from the page context so the cookie attaches. No token, none should be sent.
A 401 means the tab isn't signed in or the session lapsed — re-auth in the tab.
A bare shell `curl` has no cookie and will 401.

**Headless with no browser (ChatGPT Actions, a scheduled runner): a Bearer token.**
`Authorization: Bearer <token>`. Ben mints it on the site (sidebar → 🔑 API
token); it is a full-access, one-year credential for his account. A 401 here means
the token is missing, wrong, or revoked — ask Ben for a fresh one.

If you are ChatGPT: you cannot use a cookie, so the token is your path, and it is
configured in your Action's authentication — not in any instructions text. No
prompt can grant you access; only the Action can.

## The flow, and who is allowed to do what

```
   Cowork sweeps  ->  POST /suggestions  ->  JOBS FOR YOU  ->  Ben clicks Add
                                                                     |
                                                                     v
   Ben works it  <-  TO-APPLY (his worklist)  <----------------------+
        |
        v
   PATCH applied  ->  APPLICATIONS  ->  status moves as things happen
```

Two hard rules, both **enforced by the API**, not conventions:

1. **You never add to To-Apply.** `POST /api/v1/apply-queue` requires
   `actor:"user"` and returns **409** for anyone else. That field belongs to Ben's
   own clicks — never send it. Your candidates go to `/suggestions`.
2. **You never curate the feed unprompted.** Don't dismiss jobs to tidy Jobs For
   You on your own judgment — that is how his own picks went missing.
   **But when Ben asks you to clean it up, do it.** "Clear the junk", "get rid of
   the BPO ones", "dismiss anything needing a clearance" are instructions, and
   dismissing is reversible. Do exactly what he asked, nothing wider, and report
   what you removed and why. Unprompted = never. Asked = yes, and say what you
   did.

Queue skips are the one exception, and they need a structured reason — see below.

## Endpoints

### Surface candidates → Jobs For You
```
POST /api/v1/suggestions
{ "jobs": [ {
    "company": "...", "title": "...",
    "url": "<ORIGINAL employer/ATS link — never an aggregator>",
    "location": "Tampa, FL", "arrangement": "remote|hybrid|onsite",
    "salaryMin": 95000, "salaryMax": 120000,
    "experience": "3-5 years",
    "skills": ["SQL","Power BI","Excel"],
    "description": "<short JD excerpt>",
    "note": "<why it fits — REQUIRED, 12-30 words, role-specific>"
} ] }
-> { ok, added, suppressed, rejected, results:[{jobId, accepted, suppressed, reason}] }
```
- The field is **`description`**; `snippet` is accepted as an alias (GET /matches
  returns the stored text as `job.snippet`). Both spellings work; prefer
  `description`.
- **Suppression is visible**: a suppressed result's `reason` names the prior
  action and its date — "already skipped on 2026-08-20 (exact job_id)",
  "already in the tracker as interview (company+title match, application
  91c5bb42)". Nothing vanishes silently.
- **Dedupe is two-layer**: exact `job_id`, then normalized company+title against
  the applications tracker and dismissed cards — so one role seen under two URLs
  can't come back as a fresh card.
- **Corrected re-POSTs update the same card.** Re-POST a live suggestion with a
  fixed url / remote flag / salary and the result says `updated existing card`
  (matched on normalized company+title) instead of minting a new one.
- `note` is **enforced**: missing or too thin → that job is rejected.
- Pay / Location / Experience / Skills are the four **standard card facts**, shown
  in that order on every card. Omit one and the card reads "Not listed" — a
  visible gap Ben has to go open the posting to fill. Fill all four from the
  posting; never invent them.
- Already-dismissed or already-applied jobs come back `suppressed`. That is the
  site doing the deduping — see "no exclusion list" below.

### Jobs For You — read and clean up
```
GET   /api/v1/matches?origin=cowork&status=matched      the board Ben reviews
PATCH /api/v1/matches { jobUuid, status }               dismiss / restore one
```
`status`: `matched` (on the board) · `skipped` (dismissed, "Not interested") ·
`hidden` · `queued` (he added it to To-Apply) · `applied`.

Each row carries `statusChangedAt` (when it was dismissed/moved), and every GET
returns `meta.totalRecords` (the TRUE count for your filters), `meta.returned`,
and `meta.limit` — if `returned < totalRecords` your read-back was truncated;
raise `limit` (up to 1000).

Use `skipped` to dismiss and `matched` to put one back. This is the cleanup path
— see rule 2: only on Ben's instruction, then tell him what you removed. Nothing
is destroyed; a dismissed card can always be restored.

### Job identity
```
POST /api/v1/job-id   { company, title, location, url }  ->  { jobId }
```
Every posting has one canonical `job_id`. **Never invent or hash one.** Pass the
employer/ATS URL and you get the stable ATS-anchored form; without it you get
the weaker `jid_sig-…`. Recognized systems (2026-08-22): Greenhouse, Lever,
Ashby, Workday, **ADP, Oracle Recruiting Cloud, iCIMS, SuccessFactors,
Paylocity, Taleo, SmartRecruiters**. Details in the `job-identity` skill.

**Keep no local exclusion list.** Do not remember what you've seen, skipped, or
applied to, and do not pre-filter candidates against such a list. The site
suppresses by `job_id`. A private list drifts and causes misses.

### The To-Apply worklist
```
GET   /api/v1/apply-queue?status=pending
GET   /api/v1/apply-queue?status=pending,hold             (worklist + held rows)
GET   /api/v1/apply-queue?status=skipped&reason=gated     (the revivable backlog)
PATCH /api/v1/apply-queue { id, action:"applied", appliedAt? }   promote to Applications
PATCH /api/v1/apply-queue { id, action:"update", notes?, title?, location?, url?,
                            resumeUrl?, coverUrl?, priority? }
PATCH /api/v1/apply-queue { id, action:"skipped", reason, detail }
PATCH /api/v1/apply-queue { id, action:"hold", reason, detail }  flag, do NOT remove
PATCH /api/v1/apply-queue { id, action:"release" }               clear the hold
PATCH /api/v1/apply-queue { id, action:"reset" }                 back to pending
```
`reason` must be one of — and `detail` is required, ≥20 chars, concrete:

| reason | meaning | revivable |
|---|---|---|
| `dead` | posting removed / 404 / req pulled | no |
| `closed` | exists, no longer accepting | no |
| `gated` | blocked only on sign-in / account / captcha | **yes** |
| `screened_out` | conflicts with a stated constraint | maybe |
| `off_target` | outside the search targets | maybe |
| `duplicate` | same req already applied to | no |

### Hold — when you find a reason NOT to apply to something already queued

Ben put it on the list; you do not take it off. When you discover, after the
fact, that a queued job should not be applied to — the band came in under the
floor, the req closed, it needs a clearance — **hold it, do not skip it**:

```
PATCH /api/v1/apply-queue { id, action:"hold", reason, detail }
```

The row stays in To-Apply, visibly flagged with your reason, and Ben releases it
or skips it himself. `reason` is required and `detail` must be ≥20 concrete
chars naming what you found and where.

| reason | use when |
|---|---|
| `closed` | the req is no longer accepting applications |
| `pay_below_floor` | the posted band sits entirely under the $77,000 floor |
| `location` | on-site / geography conflict |
| `clearance` | requires a clearance Ben does not hold |
| `experience_gap` | a hard requirement he does not meet |
| `duplicate` | the same req is already in the funnel |
| `employer_flag` | BPO / gig / staffing mill / never-surface category |
| `gated` | needs Ben signed in at the keyboard |
| `other` | anything else — the detail carries the weight |

Hold vs skip: **skip removes a row from the worklist, hold leaves it there.** If
you are about to skip something Ben queued himself, you want hold. Holding an
already-applied row returns 409 — a hold cannot un-apply anything.

Prefer `gated` when unsure: a wrongly-dead row is lost, a wrongly-gated row just
gets re-checked. Use `duplicate` **only** when an application to that same req
genuinely exists. When correcting your own mistaken write, use `reset`.

### Applications
```
PATCH /api/v1/applications/<uuid> { action:"setStatus", status, submittedAt? }
POST  /api/v1/applications/manual { company, title, url, jobId, status, appliedAt, notes }
PATCH /api/v1/applications/<uuid> { action:"attachDocs", resumeUrl, coverUrl }
PATCH /api/v1/applications/<uuid> { action:"update", title?, location?, url? }
```
Statuses: `applied | interview | offer | hired | rejected | withdrawn`
(`hired` is the terminal win state, after offer).

- **Verify the response**: the returned `status` must equal what you sent. Anything
  else — especially `readyToApply` — is a failure; report it, don't move on.
- Unknown or missing action → **400, nothing changes**. Never retry the same body;
  fix the shape.
- Timestamps: send ISO **with offset** (`2026-08-07T19:30:00-04:00`). Stored
  verbatim. When you omit one, the server now stamps America/New_York offset
  time itself — but send your own; you know when the event actually happened.

### Activity log
```
POST /api/v1/activity { applicationUuid|queueId|(company+title), kind, message }
```
`kind`: `queued|tailored|gate|applied|status|note|email|error`. One human line.
This is the per-job timeline Ben reads.

### Run bookkeeping
```
GET/POST /api/v1/last-run   { lastRunAt, newEmployers }
```
Window board queries off `lastRunAt`, not a fixed 24h. Stamp it at the end of a
run with `newEmployers` = employers newly added to the Layer-1 ATS maps.

## Retired — do not use

- **Match scores.** No score is displayed anywhere. Don't compute, send, rank, or
  filter by one. Ben reads the four card facts and judges. Any "100-point rubric"
  in an older skill is dead.
- **`/Job Search/Tracking/job-search.json`** and the dashboard HTML. The site's
  D1 is the tracker of record. Don't write the JSON, don't regenerate the
  dashboard, don't POST `roadmap.benwhetstone.info/api/job-search`.
- **The site's own board sweep.** Jobs For You is fed only by `/suggestions`.
- **Direct `/apply-queue` adds.** 409. Use `/suggestions`.

## Sweep obligations

Sweep **every** pathway every run — every board, ATS, query fork, geography and
remote variant, plus the Gmail scan. Don't sample or stop early. Retry a failing
pathway; if it still fails, name it in the report. A sweep that skipped a pathway
is incomplete. Report pathways run and counts found per pathway.

**Gmail:** always open Workday "Daily Digest" emails and read them in full — they
bundle multiple updates and rejections hide inside. Treat any ATS
digest/summary/roundup the same way: enumerate every application inside and
update each. A digest counted as one email is a missed rejection.
