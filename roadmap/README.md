# Ben's Data Analytics Roadmap — roadmap.benwhetstone.info

The site's source used to live only in a working directory that no longer
exists; the Cloudflare Pages project had no Git provider, so nothing was
recoverable from a repo. It lives here now.

`public/index.html` was recovered from the live deployment. The Functions were
NOT recoverable (a deployed bundle can't be fetched), so `functions/api/` is a
faithful reimplementation built from the contract the client itself uses:

    GET  /api/progress  -> { done[], inProgress[], stage, stagesDone[], updated }
    POST /api/progress  <- { done[], inProgress[], stage, stagesDone[] }
    header: x-roadmap-key

`updated` matters: the page treats `updated > 0` as "the server has real data",
and seeds the server from localStorage when it doesn't. An empty store must
return 0, not a timestamp.

## Storage
The same KV namespace the original used — `bens-roadmap-progress`, bound as
`PROGRESS`:
- key `state`    — progress (untouched by the rebuild)
- key `salaries` — the per-stage salary bands, editable in the browser

`bens-roadmap-db` (D1) exists on the account but has no tables and is unused.

## Salary bands
They were hard-coded in the HTML, so changing them meant editing and
redeploying. They're now stored in KV and edited by clicking a band on the
page. `functions/api/salaries.ts` holds the originals as defaults, so an empty
store renders exactly what shipped.

## Deploy
    cd roadmap && npx wrangler pages deploy public --project-name=bens-roadmap --branch=main

Bindings come from `wrangler.toml`.

## Backups

The live data — board cards, progress, salary bands and the password hash — is
in KV, not D1. The nightly `d1-backups` worker sweeps six D1 databases including
`bens-roadmap-db`, but that database is an older store this page no longer
writes to, so the data people actually see was not covered.

`workers/roadmap-kv-backup` closes that. It runs daily at 07:10 UTC, just after
the D1 sweep, and writes `bens-roadmap-kv/<date>.json` into the same
`d1-backups` R2 bucket, so everything restores from one place. It refuses to
write a snapshot with an empty board, since overwriting a good copy with nothing
is worse than no backup. `GET /run` on the worker takes one on demand.

Restore with `scripts/restore-roadmap.sh <YYYY-MM-DD>`.

A pre-rebuild backup of the live progress is in
`schema/progress-backup-2026-08-08.json`.
