---
name: job-identity
description: >-
  The canonical job_id for Ben Whetstone's job search. Every job in the system —
  in the feed, the To-Apply queue, and the Applications tracker — has ONE stable
  job_id, so the SAME real-world posting is recognized as the same job no matter
  which board surfaced it or how many times it is seen. ALWAYS use this before
  queuing, applying, or logging a job: get the job_id from the site
  (POST /api/v1/job-id) and pass it on every write. This REPLACES any local
  "already seen / not interested" exclusion list you have been keeping — do not
  keep your own list; the site suppresses duplicates and dismissals by job_id.
  Trigger on "job id", "canonical id", "dedupe", "did I already apply",
  "not interested", or any time you add a job to the queue or tracker.
---

# Job identity — one job, one `job_id`

## Why this exists

The tracker used to recognize repeats by fuzzy company + title + location
matching. That over-collapsed different roles and **hid real openings**, and it
meant you (Cowork) had to keep your own running "already seen" exclusion list,
which drifted and caused misses.

That is gone. Every job now has a **canonical `job_id`** that the site computes
and stores. The same posting from Greenhouse, LinkedIn, and a Google result all
resolve to the **same** `job_id`. Dismissals ("Not interested") and
"already applied" are exact `job_id` checks done **by the site** — not by you.

> **Get rid of your exclusion list.** Do not keep a local list of jobs you've
> seen, skipped, or applied to. Do not filter candidates against a remembered
> set. The site is the memory. Ask it; it will tell you the id and it will not
> re-surface anything already acted on.

## The naming schema (for recognition only — you never build one by hand)

- ATS-anchored (authoritative): `jid_<ats>-<org>-<reqId>`
  - `jid_greenhouse-doximity-4012345`
  - `jid_lever-sardine-6f1e2a3b90`
  - `jid_ashby-notion-...`
  - `jid_workday-raymondjames-r-0011925`
- Signature fallback (no requisition known): `jid_sig-<14hex>`

The employer's requisition IS the identity, so two listings of one req share an
id even with different company punctuation ("Doximity" vs "Doximity, Inc.") or
location wording ("Remote" vs "Remote, US").

## How to get a job_id — always ask the site

**Never invent, guess, or hash a job_id yourself.** Call the endpoint. Pass the
posting URL whenever you have it — a real ATS/Workday URL yields the precise,
cross-board-stable id; without a URL you get a weaker signature id.

```
POST https://jobs.benwhetstone.info/api/v1/job-id
{ "company": "...", "title": "...", "location": "...", "url": "<posting or apply url>" }
-> { "jobId": "jid_greenhouse-doximity-4012345" }
```

Batch form: `{ "jobs": [ {...}, {...} ] } -> { "jobIds": [ ... ] }`.

## Use it on every write

Pass `jobId` on each call so the id is consistent end-to-end. If you omit it the
site derives one from the same fields — but pass the URL-derived id when you have
it, since it is the accurate one.

1. **Surface a candidate** — `POST /api/v1/suggestions` with `{ company, title,
   url, jobId, ... }`. This is your ONLY path into the pipeline. You may not
   `POST /api/v1/apply-queue`; it returns 409. Ben adds to To-Apply himself.
2. **Promote once he has applied** — `PATCH /api/v1/apply-queue
   { id, action:"applied", appliedAt }` (job_id carries into the application).
3. **Log an off-platform apply** — `POST /api/v1/applications/manual`
   with `{ company, title, url, jobId, appliedAt }`.

Auth and the full endpoint list live in the `jobs-api` skill. Follow that file.

## Permission rule — NEVER add to To-Apply on your own

The To-Apply queue is **Ben's worklist, not your scratchpad.** Adding a job to it
is an action you take ONLY when:

1. **Ben explicitly tells you** he wants to apply to a specific role
   ("add X", "queue this", "let's apply to Y"), OR
2. **Ben adds it himself** in the site with the **"+ Add a job"** button on the
   To-Apply tab.

You may **surface, score, and present** candidates freely — that is your job. But
presenting is not queuing. **Do not auto-populate To-Apply** from a sweep, a
board scan, an email, or your own judgment about what looks good. If you think
something belongs there, say so and ask; wait for a yes. One "yes, apply to
these five" covers those five — it is not standing permission to add more.

Garbage in the queue (off-target roles, guesses, bulk adds) is worse than an
empty queue: it buries the jobs Ben actually chose. When in doubt, leave it out
and ask.

## The workflow, restated

- Surface candidates and **present them with scores** — do not queue them.
- Ben says which ones to apply to (or adds his own via "+ Add a job").
- ONLY THEN: for each approved job, **ask the site for its job_id** and queue it
  (the site drops anything already dismissed/applied — you do **not** pre-filter).
- Work the queue one at a time; promote each when done.
- Trust the site's memory. No local exclusion list, ever. No unrequested adds, ever.
