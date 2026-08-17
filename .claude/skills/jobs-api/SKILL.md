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

## Auth

Call the site from **Ben's signed-in Chrome tab**. The same-origin session cookie
authenticates every request. **No token is needed and none should be sent.**

- A 401 means the tab isn't signed in or the session lapsed — re-auth in the tab.
- Make calls from the page context (browser fetch) so the cookie attaches. A bare
  shell `curl` has no cookie and will 401.
- `Authorization: Bearer …` is only for a headless runner with an env-var panel.
  Cowork has no such panel; do not look for a token.

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
2. **You never dismiss for him.** Do not PATCH `/matches` to `skipped` or
   `hidden` to curate the feed. You surface; he decides.

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
- `note` is **enforced**: missing or too thin → that job is rejected.
- Pay / Location / Experience / Skills are the four **standard card facts**, shown
  in that order on every card. Omit one and the card reads "Not listed" — a
  visible gap Ben has to go open the posting to fill. Fill all four from the
  posting; never invent them.
- Already-dismissed or already-applied jobs come back `suppressed`. That is the
  site doing the deduping — see "no exclusion list" below.

### Job identity
```
POST /api/v1/job-id   { company, title, location, url }  ->  { jobId }
```
Every posting has one canonical `job_id`. **Never invent or hash one.** Pass the
employer/ATS URL and you get the stable ATS-anchored form
(`jid_greenhouse-…`, `jid_workday-…`); without it you get the weaker
`jid_sig-…`. Details in the `job-identity` skill.

**Keep no local exclusion list.** Do not remember what you've seen, skipped, or
applied to, and do not pre-filter candidates against such a list. The site
suppresses by `job_id`. A private list drifts and causes misses.

### The To-Apply worklist
```
GET   /api/v1/apply-queue?status=pending
GET   /api/v1/apply-queue?status=skipped&reason=gated     (the revivable backlog)
PATCH /api/v1/apply-queue { id, action:"applied", appliedAt? }   promote to Applications
PATCH /api/v1/apply-queue { id, action:"update", notes?, title?, location?, url?,
                            resumeUrl?, coverUrl?, priority? }
PATCH /api/v1/apply-queue { id, action:"skipped", reason, detail }
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
  verbatim, so an evening-Eastern submit doesn't roll to the next UTC day.

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
