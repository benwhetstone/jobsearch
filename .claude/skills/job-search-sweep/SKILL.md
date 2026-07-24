---
name: job-search-sweep
description: >
  Ben Whetstone's complete job search process, Phase 0 through Phase 6.
  One invocation, one end-to-end flow: load context, scan email, search all boards,
  read JDs on employer ATSs, score with the 100-point rubric, translate each kept role,
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

### Source Order (aggregators first, not company-by-company)

**1. Large Permanent Sites (first pass, every run):**
- Indeed (indeed.com/jobs?q=...&l=Remote&fromage=3&sort=date)
- LinkedIn Jobs (for company discovery; JD body often won't render in-page)
- Glassdoor
- ZipRecruiter
- Built In (remote + entry/mid filters)

**2. Temp/Staffing Desks (second pass):**
- Robert Half, Kforce, TEKsystems, Aston Carter, Randstad, Insight Global, Motion,
  CyberCoders, Beacon Hill

**3. Specialist/Segment Boards:**
- TSPA, All Tech Is Human, ACFE, IASIU, osintjobs.com, GovernmentJobs.com, ASIS,
  Merchant Risk Council, NHCAA, IACA

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

~$60K cash for W-2 with benefits. 10% variance band: $54K is the hard DROP. Roles paying
$54K-$60K stay on the list with a note ("below floor, negotiation candidate") so Ben can
decide whether the role is worth pursuing at that range. Above $60K scores normally.

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

### Scoring Rubric (100 points)

| Factor | Max | Guidance |
|---|---|---|
| Freshness | 15 | 0-7 days = 13-15. 8-14 = 10-12. 15-30 = 7-9. 31-60 = 4-6. 60+ = 1-3. |
| Requirements match | 25 | How well approved skills match required quals. Missing required tool = -3 to -5. |
| Varied work | 20 | Highest weight. Production reporting heavy = 8-12. Mixed = 13-16. Highly varied = 17-20. |
| Company fit | 15 | Large established = 13-15. Mid-size = 10-12. Startup = 7-10. Unknown = 5-8. |
| Work arrangement | 10 | Remote = 10. Tampa on-site = 8. Lakeland = 7. Hybrid Tampa = 7. |
| Pay vs floor | 10 | Above $60K = 8-10. At floor = 5-7. $54K-$60K = 3-5 (flag). Below $54K = DROP. Not posted = 5. |
| Domain edge | 5 | Strong (LE, veteran, fraud, real estate) = 5. Some = 3. None = 2. Unfamiliar = 1. |

---

## Phase 2b: Translate the Job

**Mandatory before any resume work. Skipping this is the root cause of every bad resume.**

Write these four lines for every kept role:

1. **What they wrote.** Title and posting's own phrasing, quoted.
2. **What the job actually is.** Plain English, day to day. Who asks this person for what,
   and what do they hand back? If it cannot be said in 2-3 plain sentences, the posting has
   not been understood yet.
3. **What Ben actually does that matches.** In his own plain terms. Not resume language.
   If nothing genuinely matches, say so and DROP the role.
4. **The translation back.** Convert line 3 into their vocabulary. Because it started from
   something true, the keywords land in context.

If step 2 and step 3 do not obviously rhyme, the role is a bad fit. That is a screening
signal, not a writing problem.

---

## Phase 3: Materials (Resume and Cover Letter)

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
3. Is pay above the $54K hard floor? (If no, STOP.)
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
