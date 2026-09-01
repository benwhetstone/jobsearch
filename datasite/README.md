# data.benwhetstone.info — the portfolio site

Recovered into the repo on 2026-08-26. Like the roadmap, this site had been
deployed from a working directory that no longer exists, so its only copy was
the live Pages deployment. Everything here was mirrored from production and
verified byte-for-byte against it before the first deploy from this directory.

Cloudflare Pages project: `benwhetstone-data`

    npx wrangler pages deploy public --project-name=benwhetstone-data --branch=main

A Pages deploy REPLACES the whole site, so never deploy a partial tree — the 22
files under `assets/` are project screenshots referenced by `projects.json` and
are not recoverable from anywhere else.

## How it ties to the roadmap

`app.js` polls `roadmap.benwhetstone.info/api/progress` and uses it two ways:

- `applyRoadmapProgress` — a project card carrying a `roadmapId` takes its
  status from the roadmap (done → live, in progress → in-progress).
- `injectRoadmapCerts` — a roadmap pill listed in `ROADMAP_CERT_CATALOG` gets a
  cert card generated for it automatically, but only once it is marked done or
  in progress. Nothing appears while it sits in the To-do column.

So wiring a new roadmap item to this site means adding its pill id to
`ROADMAP_CERT_CATALOG`. Pill ids are `s<stage>:<slug-of-the-label>`, e.g.
`s1:dp-600-fabric-analytics-engineer`.
