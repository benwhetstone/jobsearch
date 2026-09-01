#!/usr/bin/env bash
# Runs automatically at the start of every session on this repo (desktop or web).
# Purpose: confirm the job-search environment is ready and load the standing rules,
# so a fresh session starts correctly with no typing from Ben. Always exits 0 so a
# missing dependency never blocks the session — it only reports.

set -u
JOBDIR="/Job Search"

mount_status="MISSING (web-only session — search/scoring/materials work; browser submit needs the desktop client)"
[ -d "$JOBDIR" ] && mount_status="ready"

token_status="not set (dashboard API POST will fail — set ROADMAP_TOKEN in the Cowork environment settings)"
[ -n "${ROADMAP_TOKEN:-}" ] && token_status="set"

cat <<MSG
[job-search session ready]
- Skills: load only from this repo's .claude/skills/ (repo is the single source of truth).
- Data: read/write the mounted "/Job Search/" Google Drive folder (tracker, resumes, cover letters, standards).
- /Job Search mount: ${mount_status}
- ROADMAP_TOKEN: ${token_status}
- To run the day's job search, invoke: /daily-job-search
- Full rules and folder layout: see CLAUDE.md in the repo root.
MSG

exit 0
