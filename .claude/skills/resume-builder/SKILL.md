---
name: resume-builder
description: >-
  Builds and tailors Ben Whetstone's tech/data-analyst resumes to a specific job posting, in his
  approved voice, with programmatic verification before anything is submitted. ALWAYS trigger when
  Ben says "build a resume", "tailor my resume", "resume for [company/role]", "redo the resume",
  "make the resume for this posting", pastes or links a job posting wanting materials, or when the
  job-application-builder skill reaches its materials phase. Also trigger on "fix this resume",
  "the resume sucks", or any request to produce or revise a resume or its summary. When in doubt
  and a resume file is the deliverable, use this skill. Never build a resume for Ben without it.
---

# Resume Builder - Ben Whetstone, tech/data roles

One rule above all the others: **a resume is evidence, not narrative.** Every failure this skill
exists to prevent came from drifting toward what sounded impressive instead of what is true and
checkable. Nine drafts were rejected in one day before the current voice was settled. Do not
relitigate any of it; it is encoded below and in the bundled files.

## Two source-of-truth files drive every resume

1. **`references/design-spec.css`** - the layout authority. Defines page setup, fonts, colors,
   grid structure, class names, and most critically the **SECTION ORDER** block at the bottom.
   Read this file every run. The SECTION ORDER comment is the single source of truth for what
   sections appear on which page and in what sequence. Do NOT hardcode section placement. Parse
   the SECTION ORDER and generate HTML that follows it exactly.

2. **`references/voice.md`** - the content authority. Contains the canonical summary, all
   experience bullets, earlier career text, education, skills, and certs. Also contains the
   rejected registers list and the bullet formula reference.

When these two files conflict, the design spec wins on layout and voice.md wins on content.

## Additional source-of-truth files (read every run)

3. `Job Search/Misc/Resume Standards - Whetstone.md` - facts about Ben. Wins every conflict
   on what skills/facts are allowed. Rules change often; violating rule 6 (the skill list) has
   already reached live applications once.
4. `Job Search/Misc/Career Profile - Ben Whetstone.pdf` - positioning and screening filters.
5. `references/best-practices-2026.md` - ATS/AI-screening mechanics. Form only.
   **Never source a skill name or a fact from a best-practices file.**

## The build process

### 0. Read both source files

Every resume build starts by reading `references/design-spec.css` and `references/voice.md`.
Parse the SECTION ORDER comment block from the CSS to determine page layout. Do not assume
any section lives on any particular page. The spec changes; the HTML follows.

### 1. Translate the job first (skip for general resume)

Before writing anything, produce four lines (Phase 2b of the job-search process):

1. What they wrote - title and quoted phrasing.
2. What the job actually is - two or three plain sentences.
3. What Ben actually does that matches - his real work, his words.
4. The translation back - restate line 3 with the posting's vocabulary where honest.

### 2. Generate HTML from the design spec

Build a complete HTML file that:
- Implements every CSS class defined in the design spec exactly as specified
- Places sections in the order defined by SECTION ORDER
- Uses only the fonts specified (Helvetica/Arial for body, IBM Plex Mono for labels/dates/meta)
- Uses only the colors specified (grays only: #141414, #666666, #888888, #999999, #d8d8d8)
- No italics anywhere. Bold only where the spec says.
- Populates content from voice.md's canonical blocks
- Respects bullet length constraints from the spec (~28 words, 1-2 lines max)
- Uses en dashes for date ranges, middots for separators

Content rules from the spec's CSS comments override formatting choices. If the spec says
"1-2 lines max ~28 words" per bullet, tighten bullets to fit while preserving every fact,
metric, and claim from voice.md. This is formatting, not content change.

### 3. Tailoring (3 mechanical levers only)

The experience bullets are **fixed content** from voice.md. Tailoring lives in exactly
three places:
- the **summary's middle clause** (swap which of Ben's real strengths leads)
- the **skills line ordering** (reorder categories to match posting emphasis)
- **which bullets lead** within each job (reorder, never reword)

What tailoring is not: rewording Ben's bullets into the posting's sentences. His work is
described once, truthfully, in voice.md, and it travels unchanged.

### 4. Render and verify

```bash
# Render with weasyprint
python3 -c "from weasyprint import HTML; HTML('resume.html').write_pdf('resume.pdf')"

# Render page images for visual check
pdftoppm -png -r 200 -singlefile resume.pdf resume_p1
```

Visually inspect every page before delivering. Layout breaks are invisible to the verifier.

Also run the programmatic verifier if available:
```bash
python3 scripts/verify_resume.py "resume.pdf" [--jd job_description.txt]
```

Non-zero exit means do not deliver. Fix the failure first.

### 5. Deliver

PDF only, to `Job Search/Resumes/`. Filename conventions:
- General: `Whetstone Resume.pdf`
- Tailored: `CompanyName Position Whetstone Resume.pdf`

No .docx files delivered to Ben. Ever.

## Hard rules (each one is a real incident)

- **Never emit a role with a title and no description.** Every experience entry ships with ALL of
  its voice.md bullets (reorder allowed, omit never). A job heading followed by no bullets is a
  build failure — this is the "skipped role descriptions" defect and it must never reach Ben. The
  verifier (`scripts/verify_resume.py`) now fails the build if any current role's bullets are
  missing; fix it before delivering.
- Skills come from Resume Standards rule 6 only. A posting asking for Python does not authorize
  listing Python.
- Closing Day is a "sales pipeline analytics platform for real estate teams." Ben designs and
  directs; he does not claim to have personally written the code.
- Pre-2016 careers go in the compact Earlier Career block: plain paragraphs, bold role names,
  no bullets. Exception: genuinely investigative postings (fraud, risk, claims, data integrity)
  promote the police years into the main section.
- The Army line keeps DoD standards, deployments, honorable discharge. Veteran status also
  belongs in the header.
- Two pages is fine. Do not compress to force one.
- Never state total career years.
- No em dashes in any output. Use colons, periods, commas, or en dashes for date ranges.
- No AI mentions as a skill or differentiator. AI as a product feature of Closing Day is OK.
- Summary leads with what Ben DOES for employers, not where he came from.
- $36 million in ANNUAL transaction volume (not career, not $30M).
- DP-900 NOT in summary paragraph (lives in Certs section only).
- Section heading is "Certs + Training" (not just "Certifications").
- Earlier Career stays as plain text paragraphs (Ben rejected the structured bold-title format
  with classes/dates on separate lines; bold role names inline is fine per design spec).

## Redoing an existing resume

When Ben says a resume is bad, do not generate a fresh variation from instinct. Instead:
reread voice.md, diff the bad resume against the canonical blocks and the approved summary,
name what drifted, and correct only that. If the voice itself seems to be the problem, ask
Ben to pick between two or three concretely different sentences rather than asking open
questions.
