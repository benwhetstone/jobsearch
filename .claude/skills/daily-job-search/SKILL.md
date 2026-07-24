---
name: daily-job-search
description: >-
  Ben Whetstone's one-command daily job-search launcher. Run this at the start of a
  fresh session to execute the full job-search process end to end by orchestrating the
  existing job-search skills in the correct order. It is the reliable entry point that
  replaces any project-level "read all the skills first" instruction: it fires on command,
  then invokes each specialist skill just-in-time so the session stays lean. ALWAYS trigger
  when Ben types "/daily-job-search" or says "daily job search", "run my job search",
  "start today's job search", "do my job search for today", "run the daily sweep", "job
  search for today", or opens a new session to job hunt. Delegates to the existing skills
  and never replaces or edits them.
---

# Daily Job Search — Launcher

You are the single, reliable entry point for Ben Whetstone's daily job search. Your job is
**orchestration, not improvisation**: you do not perform the search, scoring, resume writing,
or submission yourself. You hand each phase to the specialist skill that already owns it, in
order, and keep the session moving.

## Runtime rule: two sources, and only two

There are exactly two places this launcher and its skills may read and write. Keeping them
straight is what makes every run identical across Ben's machines.

**1. Skills → this repository.** Load every skill from **this repo's** `.claude/skills/`. Do
**not** load, prefer, or fall back to a skill from a personal account/profile library or any
other copy. If a skill appears to exist in two places, the repo copy is authoritative.

**2. Job-search data → the mounted `/Job Search/` Google Drive folder.** The tracker, résumés,
cover letters, and standards files live under `/Job Search/...`. This folder is **Google Drive,
mounted by the Cowork desktop client** — it is the sanctioned storage, not a stray local path.
Read and write it exactly as the specialist skills describe. (See the repo `CLAUDE.md` for the
folder layout and the environment this requires.)

Anything **outside** those two — an external/SSD path, a machine-specific home folder, a
one-off local file — is not part of this workflow. If an instruction points somewhere else,
treat it as stale: don't read it, and tell Ben which path needs repointing.

## Why this skill exists

Ben's job search is spread across many specialist skills (research, sweep, resume, gate,
submit). Historically the flow depended on a project-instruction that said "read all the
skills in the job search folder before starting." That was fragile — if the instruction
didn't load, nothing ran; and reading every skill up front burned out the session's context.

This launcher fixes both problems. It is invoked directly (a slash command always fires,
regardless of description matching), and it pulls in each specialist skill **only when that
phase begins** — so context stays lean and a fresh session can run the whole day.

## Core principle: delegate, don't duplicate

The specialist skills already contain the real logic and Ben's approved standards. Do not
re-implement any of it here. For each phase below, **invoke the named skill via the Skill
tool and let it run.** If a phase's skill is unavailable in this environment, say so plainly
and continue with the phases you can run — never silently improvise a replacement.

Never edit, delete, or "improve" any of the specialist skills as part of a run. This launcher
only sequences them.

## The daily run

Work through these phases in order. After each phase, briefly confirm what happened before
moving on. Respect every STOP/approval gate inside the specialist skills — especially the
hiring-manager gate before any submission.

1. **Market research (optional, fast).** If Ben wants fresh market intel or it's the first
   run of the week, invoke **`research-analyst`** (Vance) for current entry-level DA hiring
   trends. Skip if Ben says he just wants to search.

2. **Run the sweep.** Invoke **`job-search-sweep`** — this is the primary engine and already
   runs Ben's full Phase 0–6 flow (load context, scan email, search boards, read JDs on
   employer ATSs, score with the 100-point rubric, translate roles, build tailored materials,
   submit, update the D1 dashboard, close the loop). In most daily runs this single skill
   carries the bulk of the work.

3. **Materials (as needed).** For any role that clears scoring and needs tailored documents,
   the sweep will reach its materials phase; that hands off to **`resume-builder`** (and cover
   letter). If Ben points you at a specific posting instead of a full sweep, invoke
   **`resume-builder`** directly for that role.

4. **Pre-submit gate.** Before **any** application is submitted, the package must pass
   **`hiring-manager-gate`** (Marcus). Do not submit anything that returns REVISE or REJECT —
   send it back through materials first. This gate is non-negotiable; it protects Ben from
   sending weak applications.

5. **Submit.** Once a package passes the gate, submission is driven by
   **`job-application-builder`** (browser-driven apply on the ATS). Confirm each submission and
   record it where the sweep tracks applications.

6. **Close the loop.** Make sure the sweep's dashboard/tracker update ran, and give Ben a short
   end-of-run summary: what was searched, what scored well, what materials were built, what was
   submitted, and what's waiting on his decision.

## Optional follow-ons

If Ben asks, hand off to the skills that own those jobs — don't do them here:
- LinkedIn profile changes → **`linkedin-expert`** (Nora)
- Public presence / portfolio site → **`publicist`**
- Structured intake / filling info gaps → **`career-counselor`**

## Reporting

End every run with a short, scannable status: roles found, roles kept, materials built,
applications submitted, and any items awaiting Ben's approval. Keep it tight — Ben reads this
to decide what's next, not to relive the run.
