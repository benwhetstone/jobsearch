# Job Search — Project Instructions

This repository is the **single source of truth** for Ben Whetstone's job-search skills.
Everything the job search needs lives in `.claude/skills/` in this repo. Do not look for
job-search skills on a local drive, an external SSD, or anywhere else — they are here, and
any Cowork/Claude Code session started on this repo loads them automatically.

## The one entry point

To run the job search, invoke the launcher:

```
/daily-job-search
```

`daily-job-search` is the reliable entry point. It fires on command, then invokes the
specialist skills below **just-in-time** — one at a time, as each phase begins. Do **not**
read every skill up front; that wastes the session's context and is the reason older sessions
ran out of room mid-run. Let the launcher pull in each skill when its phase starts.

## The skills (single-homed here)

| Skill | Role |
|-------|------|
| `daily-job-search` | Launcher / entry point. Orchestrates the run; does not do the work itself. |
| `research-analyst` | Market intel (Vance) — current DA hiring trends. |
| `job-search-sweep` | The engine — full Phase 0–6 flow (email scan, board search, scoring, materials, submit, dashboard). |
| `resume-builder` | Tailored résumé + cover letter for a specific posting. |
| `hiring-manager-gate` | Pre-submit gate (Marcus). Nothing is submitted until it PASSES. |
| `job-application-builder` | Browser-driven application submission on the ATS. |
| `linkedin-expert` | LinkedIn profile changes (Nora) — optional follow-on. |
| `publicist` | Public presence / portfolio site — optional follow-on. |
| `career-counselor` | Structured intake / filling info gaps. |

## Where things live: code vs. documents

- **This repo holds the machinery** — the skills and their templates/assets (e.g.
  `resume-builder`'s `resume_components.js`, `design-spec.css`, `voice.md`). Version this.
- **Google Drive holds the outputs** — every finished résumé and cover letter. These are
  personal documents, not source code. Do **not** commit generated résumés/cover letters to
  the repo (binary bloat, privacy risk, no preview).
- **Submission flow:** the builder generates a résumé into the session's temp working space,
  the browser uploads it to the ATS from there, and a copy is saved to Drive for the record.
  The file passes *through* the container transiently; its permanent home is Drive.

## Environment requirements

These skills run from the **Cowork desktop client on Ben's own computer**, which provides three
things a bare web/cloud session does not:

- **Mounted `/Job Search/` Google Drive folder** — the data store. Expected layout:
  - `/Job Search/Tracking/job-search.json` — the application tracker (source of truth)
  - `/Job Search/Tracking/job-search-dashboard.html` — the dashboard
  - `/Job Search/Resumes/` and `/Job Search/Cover Letters/` — generated materials
    (`Archive - Submitted/` subfolders hold submitted copies)
  - `/Job Search/Misc/Resume Standards - Whetstone.md` and
    `/Job Search/Misc/Resume and Cover Letter Best Practices 2026.md` — the fixed standards
- **Chrome control (Claude-in-Chrome)** — used only for the final apply-in-browser step and to
  check confirmation emails in the personal `brwhetstone@gmail.com` tab. This is a desktop-client
  capability; a web-only session cannot fill or submit applications.
- **`ROADMAP_TOKEN`** — bearer token for the dashboard API
  (`https://roadmap.benwhetstone.info/api/job-search`). Set it once in the Cowork **environment
  settings** (env vars) so every session has it.

If a session lacks the `/Job Search/` mount or Chrome control, everything up to submission still
works (search, scoring, materials — the Google Drive connector can stand in for reads/writes),
but the browser submit must happen on the desktop client.

## Standing rules

1. **One skill per job.** Each of the skills above owns a distinct phase. Do not create a
   second skill that does the same job — duplicates make skill-firing unreliable. If a skill
   needs to change, edit it in place here.
2. **Delegate, don't improvise.** When a phase belongs to a specialist skill, invoke that
   skill. Never hand-roll a replacement for a skill that exists.
3. **The gate is non-negotiable.** No application is submitted unless `hiring-manager-gate`
   returns PASS.
4. **Repo is the only home.** If any of these skills is also installed in a personal/profile
   skill library, remove it there so it is defined exactly once. The copy in this repo wins.
