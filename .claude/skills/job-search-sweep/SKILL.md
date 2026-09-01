---
name: job-search-sweep
description: >
  Ben Whetstone's complete job search process, Phase 0 through Phase 6.
  One invocation, one end-to-end flow: load context, scan email, search all boards,
  read JDs on employer ATSs, surface every on-target role with its standard card facts,
  build tailored resumes and cover letters, submit applications, update the D1 dashboard,
  and close the loop. ALWAYS trigger when Ben says "Run the sweep", "Start the process",
  "search for jobs", "job search", "find me roles", "what's out there", "new sweep",
  "run Phase 2", "apply to these", "build a resume", "tailor my resume", or any request
  to search job boards, build resumes, or submit applications. Also trigger on "sweep update",
  "refresh the sweep", "search again", or any phase-specific request like "check my email
  for updates" or "build a resume for this role." When in doubt and Ben wants anything
  job-search related, use this skill.
---

# Job Search Sweep: The Complete Process (Phase 0 through Phase 6)

You are executing Ben Whetstone's entire job search pipeline. This skill IS the process.
One invocation covers everything from loading context through closing the loop.

**Trigger:** "Start the process" or "Run the sweep"

Ben does not approve individual applications. Every gate below is yours to enforce.
A gate that fails stops the application. No judgment calls on gates.

---

## Phase 0: Load (before anything else)

1. Read `Job Search Process - Whetstone.md` from Job Search/Misc (the master process file,
   ~590 lines, including the Learnings log). If anything in this skill contradicts the
   process file, the process file wins.
2. Read `Resume Standards - Whetstone.md` from Job Search/Misc. **Rule 6 especially, every
   run, no exceptions.** This is the ONLY approved skill list.
3. Read `Career Profile - Ben Whetstone.pdf` from Job Search/Misc (6 pages). Contains
   personality assessment, fit filters, search scope with 3 forks, geography rules.
4. GET current state from the **D1 database** (never the local JSON, it goes stale). Build
   dedupe set of all companies+roles already applied to.
5. Read any prior sweep .md files in Job Search/Tracking to avoid re-presenting dropped roles.
6. Pull the skill list from **data.benwhetstone.info** and reconcile against rule 6. Any
   difference gets flagged to Ben, never silently resolved.
7. Dispatch the search agent (Phase 2) now so it runs while Phases 1 and 1b happen.

---

## Phase 1: Email Scan + Market Research

### 1a: Email Scan

Search Ben's **personal Gmail in Chrome** (the connected Gmail MCP is the WORK account
and will not have job search emails).

- Check `label:Job-Search/Applications` for anything new since last run
- Check the inbox for responses that escaped the filters
- Any status change gets recorded: rejection, interview request, request for information
- Search for recruiter outreach, job alerts, and Greenhouse/application verification codes
- Standing permission to retrieve email verification codes from Gmail (codes only, never
  passwords)

### 1c: Market Research (Vance Keller, research-analyst skill)

Run the research-analyst skill. Vance scans LinkedIn and the web for current entry-level
DA hiring trends, in-demand skills, recruiter behavior, and career changer intel. He
produces a Research Brief that downstream phases read before building materials.

This runs in parallel with Phase 1a (email scan). The brief informs:
- Phase 2b (translation): which skills to emphasize based on current demand
- Phase 3 (materials): whether any resume positioning needs updating
- Phase 3b (Marcus gate): current market calibration for the evaluation

If Vance flags a positioning change (e.g., a skill trending up or down), that gets routed
to Nora (linkedin-expert) for LinkedIn updates and to the resume-builder for resume updates
before materials are built.

### Supporting: LinkedIn Profile (Nora Shields, linkedin-expert skill)

Nora owns Ben's LinkedIn profile. She runs a full audit at least once per month, or when
Vance flags a market shift. She does NOT run every sweep cycle, only when:
- Vance's research brief identifies a positioning change that affects LinkedIn
- Ben explicitly requests a LinkedIn update
- It's been 30+ days since the last audit
- A new cert, project, or role change needs to be reflected

When triggered, Nora audits the profile, presents recommendations to Ben, and executes
approved changes via Chrome MCP.

---

## Phase 1b: Dashboard, First Pass

- GET current state from the D1 database
- Apply status changes found in Phase 1
- **Append notes, never overwrite.** Format: `terms | MM/DD event | MM/DD event`
- POST back. Send only the schema fields below. **Never send `id` or `source`** (that
  created a duplicate row on 2026-07-20).
- The API is append/update. POST new or changed entries and it adds or updates them.

**Dashboard schema:**
```
{
  "date":      "YYYY-MM-DD",
  "company":   "",
  "role":      "",
  "url":       "",
  "channel":   "",
  "pay":       "$85-95K",
  "work_mode": "R",
  "emp_type":  "P",
  "status":    "in_progress|submitted|interview|offer|rejected|withdrawn",
  "notes":     ""
}
```

Field values: work_mode: IO = in office/on-site, R = remote, H = hybrid. emp_type: P =
permanent/full-time, CT = contract/temporary. All optional except company, role, status.

- GET again and verify the write actually landed. The endpoint returns `ok:true` on writes
  it does not perform when a row is Ben-edited and protected.

**Notes field rules (Resume Standards rule 10):**
Write: pay/terms, req/job number, something Ben still has to do, real signal from a human,
one-line role hook if title alone is vague.
Never write: anything restating the status column, audit trail about the tracker, process
notes about how the application was filled, notes contradicting the status field.
Blank is valid. Most rows should have one.

---

## Phase 2: Search All Sources

### Where to search — FIVE LAYERS, in this order

Layer 1 is the backbone. Leading with aggregators is what produced months of
slop: BPO reposts, staffing-agency churn, data-labeling gigs and stale
duplicates. Aggregators are a **discovery** layer that feeds employers INTO
Layer 1, not a source of truth.

**Layer 1 — ATS APIs (the backbone; the only layer that sees same-day reqs).**
Query employers' own systems directly:
- Workday (`/wday/cxs/<tenant>/<site>/jobs`), Greenhouse, Lever, Ashby,
  iCIMS, SuccessFactors, Paylocity.
- Maintain a map of Tampa-Bay + remote-friendly employers per system. Every run,
  add newly discovered employers to it and report the count added
  (`newEmployers` on `POST /api/v1/last-run`). That number trending to zero is
  the honest signal that discovery has saturated.
- These postings carry a real requisition id, which is what gives a job its
  stable ATS-anchored `job_id`.

**Layer 2 — LinkedIn + Indeed, as DISCOVERY ONLY.**
Use them to find *employers* you don't have in the Layer-1 maps, then go get the
req from that employer's ATS and post THAT url. Do not treat them as a second
net, and never post an aggregator link as the posting url — it degrades the
`job_id` to the weak signature form.

**Layer 3 — rendering aggregators** (Glassdoor, ZipRecruiter, Built In): sweep,
but expect duplicates of Layer 1. Resolve to the employer link before posting.

**Layer 4 — login-gated boards.** Where a JD won't render, try Glassdoor, a
LinkedIn embed, or direct URL variants. Note it if the JD can't be verified.

**Layer 5 — small government / court / university boards.** GovernmentJobs.com,
Florida state and county sites, court systems, USF and other universities. These
carry real analyst roles the big boards never surface, and they're often
low-competition. Include them every run.

**Google for Jobs is NOT used.** Tested and rejected: it missed a Raymond James
req posted the day before, returned a Petersburg VA result for a Tampa query,
never identified a live Florida bankruptcy-court posting as a job at all, and
served stale duplicates of a live req.

**Staffing desks are DEMOTED, not a pass of their own.** Robert Half, Kforce,
TEKsystems, Aston Carter, Randstad, Insight Global, Motion, CyberCoders and
Beacon Hill repost the same reqs with the employer hidden. Only surface one when
the role is genuinely strong AND you cannot find the direct employer posting; say
in the note that it's an agency listing.

**Specialist/segment boards** (worth a pass for domain-edge roles):
TSPA, All Tech Is Human, ACFE, IASIU, osintjobs.com, ASIS, Merchant Risk
Council, NHCAA, IACA.

### Never surface these (they are the slop)

Drop outright, don't rank-and-hope:
- **BPO / outsourcing shops**: TELUS Digital/International, Teleperformance,
  Concentrix, Foundever, TTEC, Alorica, iQor, Conduent, Majorel, Transcom,
  Sutherland, Genpact, TaskUs, DCX, Appen, Arise, Liveops.
- **Data-labeling / micro-task / "AI trainer" gigs** dressed up as analyst work:
  annotator, labeling specialist, search quality rater, transcription, data
  entry, crowdsourced, 1099 gig work.
- **Roles requiring an active security clearance** (TS/SCI, polygraph, DoD
  Secret, public trust). Unreachable without one.
- **Off-field titles** that merely share a word: Data Engineer, Data Scientist,
  Program/Project Manager, Software Engineer, Financial/Credit/Risk Analyst with
  no analytics content.

### On-target titles

Data Analyst, Business Analyst, Business Intelligence Analyst, Reporting
Analyst, Analytics Analyst, Data/Business Insights Analyst, Operations Analyst
with real reporting content. Seniority up to Senior is in scope; Manager and
above is out unless it is explicitly an IC role.

### Three Standing Search Forks (sweep ALL three, every run)

- **Fork A: Data mainly.** Core data-analyst track + fraud/FWA/payments/investigations.
- **Fork B: LE-adjacent.** LE-tech vendors (Axon, Flock Safety, Mark43, Peregrine,
  SoundThinking, Versaterm, CentralSquare, Cellebrite, Tyler, Hexagon, Genetec, Motorola
  Solutions) + investigations-flavored data roles.
- **Fork C: Economy-wide.** Every sector: healthcare, insurance, banking/fintech, retail,
  CPG, logistics, real estate/proptech, hospitality, utilities, telecom, media/gaming,
  education, manufacturing, non-profit, government-adjacent (non-clearance), sports, SaaS.
  Title is the constant (Data Analyst, BI Analyst, Reporting Analyst, Operations Analyst,
  Insights Analyst, Business Analyst with real data content); industry is the variable.

### Segmented Search Protocol (run and report every segment)

- A. Data / Fraud / Risk analytics, US Remote
- B. LE-tech / GovTech / public-safety vendors
- C. Economy-wide generalist Data Analyst, US Remote
- D. Tampa Bay local (on-site/hybrid). Big employers: Raymond James, USAA, JPMorgan, Jabil,
     Publix, Tampa General, ConnectWise, Nielsen. Plus local staffing desks.
- E. Temp / Contract, remote or local
- F. Trust & Safety track. TSPA job board, All Tech Is Human

### Search Rules

- **Two separate searches per source, per search term.** Never combine location and
  remote in one query. Run them as distinct passes:
  1. **Tampa local pass:** Keyword = [search term]. Location = "Tampa, FL" (or the site's
     equivalent with a radius). No remote filter. This covers Segments A-D local.
  2. **Remote pass:** Keyword = [search term]. Location = leave blank, or set to
     "United States" / nationwide (however the site handles it). Then activate the site's
     **remote filter/toggle**. Never type "remote" as a keyword in the search bar. The
     filter catches every remote-eligible posting; the keyword misses any that don't put
     "remote" in the title.
  Site-specific location mechanics:
  - Indeed: Tampa pass = Where: "Tampa, FL". Remote pass = Where: blank + &remotejob=1,
    or Where: "Remote"
  - LinkedIn: Tampa pass = location "Tampa Bay Area". Remote pass = location filter set
    to "Remote"
  - Glassdoor: Tampa pass = location "Tampa, FL". Remote pass = location dropdown "Remote"
  - ZipRecruiter: Tampa pass = location "Tampa, FL". Remote pass = location "Remote"
  - Built In: Tampa pass = location "Tampa". Remote pass = "Remote" filter toggle
- **Adapt when results are thin.** If a search returns fewer than 5 qualifying roles, do
  not just report "no qualifying roles" and move on. Diagnose why and try fixes:
  - Broaden the title (e.g., "analyst" instead of "data analyst")
  - Drop experience-level filters (entry/mid)
  - Try synonym terms ("reporting analyst", "insights analyst", "BI analyst")
  - Widen the radius for Tampa local
  - Check if the site's filters are over-constraining (date posted, salary, etc.)
  - Try a different sort order (relevance vs. date)
  Report what you tried and what changed. If the market is genuinely dry for a segment,
  say so with evidence (X searches across Y sites, Z total results, none qualifying
  because [reason]).
- Use multiple search term variations per source (title variants, keyword combos)
- Record the exact search terms used for each source
- **READ THE JD ON THE EMPLOYER'S OWN ATS before scoring.** Job board summaries are
  unreliable. Navigate to the company careers page and read the full posting.
- If the employer ATS is behind a login wall, try alternative paths (Glassdoor, LinkedIn
  embed, direct URL variations). Note in the output if full JD could not be verified.
- Dedupe against the D1 tracker AND Resumes/Archive - Submitted/ before presenting. Never
  resurface a company+role already applied to.
- Open every posting and confirm it loads before it goes on the list. Dead links have
  embarrassed us twice.
- Report every segment even if zero qualifying roles found.
- Growth-phase signal check: for every candidate role, look for hints the company is scaling
  (recent funding, many simultaneous openings, "build from the ground up" language, Series
  B-D).

### Career Profile Filters (apply to every role)

- Existing analytics team you JOIN (not build). Non-negotiable.
- Varied problems over production reporting. THIS IS THE HIGHEST WEIGHT FILTER.
- Stakeholder-facing work.
- Mid-to-large established company preferred. Startups get deducted.
- No sales/consulting/agency roles. No quota-adjacent, no client-facing revenue.
- Not Senior/Lead/Principal/VP title bar (exception: purely an experience bar his background
  meets).
- Tampa Bay area OR US remote. Commutable = Tampa, Brandon, Riverview, St. Pete (hybrid
  preferred). Clearwater is too far unless remote.
- Normal hours; no consulting or agency.

### Pay Floor

Band: $77,000-$100,000. Floor: $77,000 (updated 2026-08-22). A posting whose band
ENTIRELY sits below $77K is a drop. A band that straddles the floor stays on the list
flagged "below floor, negotiation candidate". If a posting's own band runs higher than
ours, that's fine - salary answers go inside the posting's band.

### Qualification Gate (Hail-Mary Test)

"Some stretch is OK, not a hail mary."

- **KEEP (justifiable stretch):** roles where Ben can hold the interview room even if he
  doesn't check every box. The conversation is true stories about his real work, and any
  gap is arguable, not fatal. Coin-flip odds are fine. Missing a "preferred" qual, or a
  required qual his 10 yrs LE + ops + SQL/Power BI genuinely substitutes for, is a KEEP.
- **DROP (hail-mary):** roles where he'd get exposed in the first ten minutes. A required
  minimum he flatly does not have and can't substitute.
- The test: could Ben walk into that interview and be honest the whole way without a fatal
  "I've never actually done that"? If yes, keep. If a core requirement forces a no, drop.

### Approved Skill List (Resume Standards Rule 6)

SQL, T-SQL, Power BI, Excel advanced, Google Sheets advanced, Data Analysis, Data
Visualization, DP-900, Google Ads, CRM admin, relational data modeling, data quality QA.

**NOT approved:** GA4, Google Analytics, GTM, Tableau (only "in progress"), Python (only
"in progress"). A keyword the posting asks for does not authorize adding it.

### Hard Drops

- Any regulated specialty gate (BSA/AML/SAR, HL7/CCDA/clinical, HMDA/CRA, Call Report,
  FRB/OCC reg-reporting, enterprise data-governance requiring Collibra/Informatica)
- Any clearance-required role (sponsorship timelines too long)
- Below pay floor
- Agency drug-screening standards (probable no for Ben, flag before applying)

---

## Phase 2 Output Format

Present in chat AND save to a dated .md file in Job Search/Tracking/.

### 1. Sources Searched and Search Terms (table)

| Source | Search Terms | Result |
|---|---|---|
| [source name] | [exact terms used] | [what was found or "No qualifying roles"] |

Every source gets a row, even if zero results.

### 2. Qualifying Roles (ranked by score, highest first)

For each role:

**[Rank]. [Company] - [Title] | [Location, arrangement] | [Score]/100**
[ATS link](url)

[One paragraph: years required, key tools, what the work actually is, company size/type,
team structure, notable details.]

| Factor | Points | Notes |
|---|---|---|
| Freshness (/15) | X | [specific justification] |
| Requirements match (/25) | X | [what matches, what's missing] |
| Varied work (/20) | X | [production reporting vs varied] |
| Company fit (/15) | X | [company size, structure, team] |
| Work arrangement (/10) | X | [remote/on-site/hybrid, commute] |
| Pay vs floor (/10) | X | [posted pay or "not posted"] |
| Domain edge (/5) | X | [relevant experience or lack thereof] |

### 3. Drops (table)

| Role | Reason |
|---|---|
| [Company - Title] | [specific disqualifier] |

### 4. Segment Coverage (table)

| Segment | Result |
|---|---|
| A. Remote data/fraud/risk | [result] |
| B. LE-tech/GovTech | [result] |
| C. Economy-wide remote | [result] |
| D. Tampa local | [result] |
| E. Temp/contract | [result] |
| F. Trust & Safety | [result] |

### 5. Market Read

One honest paragraph on what the market looks like at Ben's level right now.

### RETIRED: the 100-point rubric. Do not score.

Match scores are gone. Nothing in the app displays one, and computing one wasted
time and produced numbers that disagreed with reality (a role whose required tool
list was verbatim Ben's approved skills once scored 14; roles with real Tableau
and BigQuery gaps scored 91).

Instead: **surface every on-target role with the four standard card facts filled
in and a specific "why it fits" note.** Ben reads the facts and decides. Your job
is coverage and honesty, not ranking.

**Do not filter by a judgment call either.** Rank-don't-filter. There are only
these hard drops:
- a genuine seniority mismatch in the title (Manager+ that isn't an IC role),
- a posted band entirely under $77K,
- a required active security clearance,
- anything on the "never surface" list above (BPO, gig/labeling, off-field).

Everything else gets surfaced. A regex that discards causes false kills.

**Pay:** band $77,000-$100,000, floor $77,000 (updated 2026-08-22). Judge a posted band on its
MIDPOINT, not its bottom. An unposted band is unknown, not disqualifying — say
"Not listed".

### Source-of-truth order

1. `Resume Standards - Whetstone.md` (facts about Ben). Wins every conflict.
2. Career Profile (positioning and screening filters).
3. `references/voice.md` (bundled with this skill). The approved voice, canonical summary,
   canonical experience bullets, rejected registers.
4. `references/best-practices-2026.md` (bundled). ATS/AI-screening mechanics. Form only.
   **Never source a skill name or a fact from a best-practices file.**

### Core Principle: Ben runs a real estate business. Say so.

The resume must clearly communicate that Ben is a real estate business owner who does
analytical work as part of running his operations. Someone reading it should immediately
understand what industry he's in and what his businesses do. Do not abstract away the real
estate context into generic "analytics" language.

### Bullet Formula (Resume Worded 2026 guidance)

Every bullet follows: **Action verb + what you did + tool used + quantified result +
business outcome.**

The Resume Worded research identified these patterns from successful entry-level DA resumes:

1. **Tools woven INTO accomplishment bullets, not just listed in Skills.**
   Bad: "SQL, Python, Excel, Tableau" (just a list)
   Good: "Wrote SQL queries joining 4 real estate data sources to resolve record conflicts,
   producing a single source of truth across CRM, MLS, transaction management, and bookkeeping."

2. **Quantify with specific metrics that are true and interviewable.**
   Bad: "Analyzed sales data to identify trends and insights"
   Good: "Analyzed 3 years of lead conversion data in Excel and CRM reporting to identify
   which prospecting metrics predicted closed transactions, then rebuilt reporting around
   those KPIs."
   The second version names the data scope, the tools, and the business outcome.

3. **Strong action verbs at the start of every bullet.**
   Use: Analyzed, Built, Designed, Reconciled, Automated, Created, Managed, Developed,
   Tracked, Identified, Wrote, Produced, Delivered
   Never: "Responsible for", "Helped with", "Tasked with", "Involved in"

4. **No orphan skills.** Every skill listed in the Skills section must also appear inside
   an experience bullet with context and a result. If SQL is in Skills, there must be a
   bullet that says what SQL was used to do and what came of it.

5. **Name the industry.** Every bullet should make clear this is real estate, transactions,
   listings, leads, or SaaS serving real estate teams. A recruiter skimming should know
   the domain in 5 seconds.

### Canonical Experience Content

The canonical bullets live in `references/voice.md`. They are the approved content for
every resume. **Use them.** The experience bullets name real estate, weave tools into
accomplishments, and follow the verb+tool+result formula.

### Closing Day Description

"Sales pipeline analytics platform for real estate teams." Not "small, growing SaaS
business," not "a multi-tenant SaaS platform," not "a production data platform." Describe
what Ben did: designed the data model, defined business logic, translated business
requirements into specs. Ben directs AI agents to code; do not say "wrote SQL queries" or
"I designed" when it implies hands-on coding. Canonical language lives in
`references/voice.md` and wins on any conflict.

### Summary (approved base, updated 2026-07-23, reaffirmed 2026-07-24)

Canonical base and adaptation rules live in `references/voice.md`. Voice.md wins on any
conflict. Current base:

"Builds dashboards, defines KPIs, and delivers business reporting in SQL and Power BI.
Designed a 52-table SQL data model powering a sales pipeline dashboard with deal flow
tracking, conversion funnels, goal pacing, and commission forecasting for residential
real estate teams. Ten years owning the data infrastructure for a $36M real estate
operation across four systems (CRM, MLS, transaction management, bookkeeping):
[MIDDLE CLAUSE]. Army veteran."

Adapt ONLY the middle clause (pick from Ben's real strengths: reconciling cross-system
discrepancies and building recurring reports for leadership / translating business questions
into actionable analysis for non-technical stakeholders / data quality and validation /
KPI definition and reporting). Lead sentence always starts with what he DOES for employers,
not where he came from. No AI mentions. No "transitioning" or "career changer" language.

### Functional Titles

- Founder & Product/Data Lead, Closing Day
- Founder & Operations/Data Lead, The South Shore Team

### Header

- Subtitle: role-matched, 2-4 words per side of a middle dot
- Contact: Apollo Beach (Tampa), FL | 813-468-9832 | brwhetstone@gmail.com |
  linkedin.com/in/benwhetstone | data.benwhetstone.info
- Clearance line: ONLY when the posting names a clearance or employer is federal/defense.
  Commercial resumes carry just "U.S. Army Veteran."
- Clearance wording: "Previously held U.S. Army Secret clearance, eligible for reinstatement"

### Earlier Career Block

Plain lines, no bullets. Police Officer, Detention Deputy, tech roles, Army. No straining
patrol work into analytics. Exception: genuinely investigative postings (fraud, risk, claims,
data integrity) promote the detective work into the main section with real bullets.

### Tailoring (where it lives)

Tailoring is in exactly three places:
1. Summary middle clause (swap which strength leads)
2. Skills line ordering (three lines max, no labeled category recitation)
3. Which bullets lead within each job

What tailoring is NOT: rewording Ben's bullets into the posting's sentences.

### Cover Letter

250-400 words, named greeting, one metric-dense paragraph, specific anecdote. If the posting
asks for a tool he's learning (Python, Tableau), it goes in the cover letter as in-progress,
or nowhere.

### Build Process

**Load the resume-builder skill and follow its process exactly.** The resume-builder skill
owns the build pipeline, source files, format, and delivery. Do not build resumes any
other way.

1. Run Phase 2b translation for the role
2. Read `references/design-spec.css` and `references/voice.md` (resume-builder step 0)
3. Generate HTML from the design spec (resume-builder step 2)
4. Tailor using the 3 mechanical levers only (resume-builder step 3)
5. Render with weasyprint (resume-builder step 4)
6. Run verify gate
7. Visual inspection (pdftoppm, check page 1 layout)
8. Deliver PDF to Job Search/Resumes/

### Verify Gate

```bash
python3 scripts/verify_resume.py "<resume.pdf>" [--jd job_description.txt]
```

Non-zero exit = do not deliver, do not submit. Fix the failure first.

Also render and visually check page 1 (soffice convert, pdftoppm) before presenting.

Checks enforced: banned terms (GA4, GTM, bare Tableau/Python, eXp, career-year totals),
required elements (contact block, portfolio link, Google Sheets, veteran status),
qualified-only credentials, 2-page cap.

### Delivery

**PDF only** to Job Search/Resumes/. Never hand Ben a .docx.
Filename convention (from resume-builder skill):
- Tailored: `CompanyName Position Whetstone Resume.pdf`
- Cover letter: `CompanyName Position Whetstone Cover Letter.pdf`
- General: `Whetstone Resume.pdf`

---

## Phase 3b: Hiring Manager Gate (Marcus Webb)

**Mandatory. No resume proceeds to Phase 4 without passing this gate.**

After the verify gate (verify_resume.py) passes, invoke the `hiring-manager-gate` skill.
Marcus simulates what a real DA hiring manager sees when reviewing the resume:

1. ATS keyword audit against the target JD (or composite entry-level DA JD for generals)
2. 6-second screen simulation (would a human keep reading?)
3. 30-second deep read (bullet quality, specificity, proof of skills)
4. Career changer risk assessment (Ben-specific pitfalls)
5. Verdict: PASS / REVISE / REJECT

**If REVISE:** resume-builder fixes the specific issues Marcus flagged, then the resume
goes back through Marcus. Maximum 2 revision cycles before escalating to Ben.

**If REJECT:** flag to Ben with Marcus's specific reasoning. Do not submit.

**If PASS:** proceed to Phase 4.

The verify gate and the Marcus gate check different things. Verify catches rule violations
(banned skills, missing elements). Marcus catches effectiveness problems (would a hiring
manager actually call this person?).

---

## Phase 4: Submit

### Pre-submit checklist (answer each in chat before submitting ANY application)

1. Is this role in the drops table? (Check. If yes, STOP.)
2. Does the title match an approved title constant (Data Analyst, BI Analyst, Reporting
   Analyst, Operations Analyst, Insights Analyst, Business Analyst with real data content)?
   (If no, STOP.)
3. Is the posted band at least partly at/above the $77K floor? (Entirely below: STOP.)
4. Was the resume-builder skill loaded and its source files (design-spec.css, voice.md) read?
   (If no, STOP and go read them.)
5. Was the resume built with the HTML/weasyprint pipeline? (If no, STOP and rebuild.)
6. Did verify_resume.py pass? (If no, STOP and fix.)
7. Did the Marcus gate pass? (If no, STOP.)

If any answer is no, the application does not proceed. No judgment calls.

### Browser rules

- **Navigate natively.** Use `read_page`, `form_input`, `navigate`, and DOM tools to
  interact with pages. Avoid screenshots. Read page content through the extension's text
  extraction, not visual inspection.

### Form filling

- Check the D1 tracker for this company one more time before opening the form.
- Use `form_input` with a ref. Raw JS value-setting does not trigger React state.
- Hidden file inputs: use `find` for the real `type="file"`.
- macOS: `cmd+a` to clear a field, never `ctrl+a`.
- **GATE: read back every dropdown and radio value through the DOM before clicking submit.**
  Typing "No" + Enter selects the highlighted option, not the typed one.
- Identity facts: Benjamin legal / Ben preferred. Protected veteran YES. Disability YES.
  Never answer Hispanic/Latino ethnicity. Race: undisclosed.
- Never close a tab holding a filled, unsubmitted form.
- **GATE: status is `submitted` only with a confirmation screen observed this session or a
  receipt email. Otherwise `in_progress` with a note saying exactly what is missing.**
- Never enter passwords, account numbers, or SSN.
- Get Greenhouse codes from Gmail.

---

## Phase 5: Dashboard, Second Pass

- GET current state from D1 first. Build the POST payload from the GET response.
- Add new or updated entries to the payload without `id`/`source`.
- POST the complete list. D1 upserts by company+role, so duplicates resolve naturally.
  Do not guard against duplicates on the client side.
- GET again to verify the write landed.
- Update the Cowork artifact
- Archive on submit, same turn: move resume (and cover letter) from Resumes root into
  `Resumes/Archive - Submitted/`. Root is current-sendable only.

---

## Phase 6: Close the Loop

- Append to the Learnings log in the process file: what worked, what broke, what to change
- If something new was learned about Ben, that goes in Resume Standards or Career Profile
- Report to Ben: what was applied to, what was skipped and why, what needs him

---

## Standing Rules

- Resume Standards governs facts about Ben. Never source a skill name from a best-practices
  file. That is exactly how GA4 reached live applications.
- Notes are append-only. Overwriting destroyed the one actionable note on the board.
- Never report success on an unverified operation. The D1 endpoint returns ok:true on writes
  it does not perform. Read back before claiming it worked.
- The D1 POST endpoint upserts by company+role. GET first, build payload from the GET
  response (include all existing rows plus new additions), POST the complete list, GET
  again to verify. Do not guard against duplicates on the client side; the upsert handles
  collisions. Never send `id` or `source` fields.
- Never delete Ben's files. Move to a clearly named folder and tell him.
- Don't ask what a file already answers.
- Deliver lists IN CHAT, not as a separate document. Ben wants the full list directly in the
  conversation. A tracking file is additionally written for the record.
- Open every posting and confirm it loads before it goes on the list.
- Rank-order lists.

## Redoing a Resume

When Ben says a resume is bad, do not generate a fresh variation from instinct. That loop
produced nine rejections. Instead: reread `references/voice.md`, diff the bad resume against
the canonical blocks and the approved summary, name what drifted, and correct only that. If
the voice itself seems to be the problem, ask Ben to pick between two or three concretely
different sentences rather than asking open questions; he calibrates fast on choices and has
no patience for interrogation.

## General/Untailored Resumes

For LinkedIn and job board profiles, build a general-purpose resume using the canonical
bullets and the general middle clause ("KPI definition, pipeline and financial reporting,
and data quality across four integrated systems"). No clearance line. Subtitle:
"Data Analytics . Business Intelligence". This is the default resume for passive applications
and profile uploads.

## Security Rules (non-negotiable)

- Never answer Hispanic/Latino ethnicity
- Race: undisclosed
- Veteran: YES
- Disability: YES
- Never enter passwords/accounts/SSN
- No em dashes in any output
- Standing permission to retrieve email verification codes from Gmail (codes only, never
  passwords)
