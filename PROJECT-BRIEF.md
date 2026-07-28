# Project Brief: Job Search Engine v2

**Paste this whole file into Claude Code as the project spec.**

Source: full technical teardown of globalwork.ai (authenticated account, 2026-07-28). Every API contract, data shape, and enum below was pulled from live authenticated responses or their production JS bundle. Nothing here is guessed unless explicitly marked INFERRED.

> **This draft has been through an adversarial verification pass.** Eight independent verifiers were asked to refute the major claims; four found real errors, which are corrected inline below and catalogued in `notes/04-CORRECTIONS-and-scoring-formula.md`. Chasing one of them produced the exact scoring formula in §5.2. Where a claim is observed on a single sample or derived from bundle source rather than an API response, it now says so.

---

## 0. What we are building and why

Ben Whetstone runs a data-analyst job search out of a Cloudflare D1 table (`bens-job-search-db.applications`) plus a set of Claude Cowork skills (`job-search-sweep`, `job-application-builder`, `hiring-manager-gate`, `research-analyst`, `linkedin-expert`, `daily-job-search`). It works, but the state lives in flat markdown sweep files and a 13-column table, and every decision is re-derived by an LLM on every run.

globalwork.ai is a $25/mo consumer product that solves the same problem with a **structured data model instead of prompts**. The teardown showed that almost all of their leverage comes from four ideas that are cheap to copy and do not require their scale:

1. A **server-defined profile schema** where every field carries the plain-English question it answers.
2. A **two-stage retrieve-then-rank** match pipeline with per-dimension explainable scores.
3. An **ATS form mirror** — scrape the employer's form, render it natively, prefill it, hold for human approval.
4. **Deterministic enums everywhere**, so matching is arithmetic instead of an LLM call per job.

We are not building a competitor. We are rebuilding Ben's personal tooling on their architecture. Single user. No auth beyond a bearer token. No billing. No growth stack.

**Success condition:** Ben opens one dashboard, sees ranked roles with an explained match score, clicks one button, reviews a redlined resume and a prefilled application form, and approves. Everything else is bookkeeping the system does for him.

---

## 1. What already exists (do not rebuild)

| Asset | Location | Keep / Replace |
| --- | --- | --- |
| D1 database `bens-job-search-db` (id `b242bc78-7e28-4600-bfde-524ab7842283`, account `3227349e78dd7704315d1a7e1e25a58e`) | Cloudflare | **Keep**, extend schema |
| `applications` table (13 cols) | D1 | **Keep**, becomes one table of many |
| Dashboard | `https://roadmap.benwhetstone.info/job-search` | **Keep**, add views |
| API endpoint | `POST/GET https://roadmap.benwhetstone.info/api/job-search` (Bearer auth, upsert by company+role) | **Keep**, add routes |
| Resume pipeline | HTML → weasyprint → PDF, `design-spec-v2.css`, `voice.md`, `verify_resume.py` gate | **Keep** as the renderer; feed it structured data instead of prose |
| Cowork skills | `job-search-sweep`, `job-application-builder`, `hiring-manager-gate`, etc. | **Keep**; they become clients of the new API instead of holding state themselves |
| Chrome MCP | driving ATSs in-browser | **Keep**; this is our auto-apply executor |

Hard constraints from `Automation/CLAUDE.md` that the new system must enforce **in schema, not in prompt**:

- Pay floor $60K cash W-2; $54K hard drop; $54–60K flagged as negotiation candidate.
- Skills come from `Resume Standards` rule 6 only. Never harvest a skill from a job posting.
- First name on applications: "Benjamin".
- Protected veteran: YES. Disability: YES. Ethnicity Hispanic/Latino: never answered. Race: undisclosed.
- No em dashes in any generated output. Use colons.
- No AI as a resume skill or differentiator. No Lofty, SkySlope, CRM, or Google Ads in the skills section.
- Never enter passwords, account numbers, or SSN.
- Closing Day is described as a "sales pipeline analytics platform".
- $36 million in **annual** transaction volume for SST.

These are not style notes. Encode them as validation rules with a gate that blocks delivery.

---

## 2. Architecture

Stay on the stack Ben already pays for.

```
Cloudflare Pages + Pages Functions      web app + API   (already deployed)
Cloudflare D1                           relational store (already deployed)
Cloudflare R2                           resume/cover-letter PDFs, form snapshots
Cloudflare Workers AI or Anthropic API  generation + classification
Cloudflare Queues or Cron Triggers      async job pipeline
Chrome MCP (local, via Cowork)          ATS form scrape + submit executor
```

Frontend: keep it boring. Server-rendered or a small React/Vite SPA served from Pages. GlobalWork ships a **2.6 MB single bundle** with no code splitting — do not copy that.

**API shape to copy:** versioned REST at `/api/v1/`, `{ data, meta }` envelope on every list response, `meta = { skip, limit, totalRecords }`. Simple, greppable, works fine.

---

## 3. The Profile Schema (their DCP) — build this first

This is the highest-value idea in the whole product. **Do not model the profile as columns on a users table.** Model it as a table of field *definitions* plus a table of field *values*.

### 3.1 Why

Their profile is 92 fields across 6 blocks. Each field row carries:

```ts
{
  fieldKey: string,
  fieldType: 'string' | 'number' | 'boolean' | 'string_array' | 'object_array',
  question: string | null,     // "What's your minimum expected salary?"
  categoryKey: string,         // UI tab grouping
  options: string[],           // controlled enum, [] for free text
  isMultiSelect: boolean,
  isMatchingParam: boolean,    // does this feed the match score
  storageTarget: string,
  order: number
}
```

Because `question` is stored on the field, **the same row drives three things**: the profile form label, the match-score input, and the answer lookup when an ATS asks a semantically similar question. Add a field once, it works everywhere. That is the whole trick.

Caveat, verified: `question` is **nullable**, and is null on 7 of the 92 fields (`driverExperience`, `nationality`, `ratePerHour`, `variableSalaryIsPercentage`, `internalSeniorityScore`, `companyMaturityExperience`, `desperateScore`). Those rows have no UI label and no answer-lookup key. Two of them look computed; `nationality` and `ratePerHour` plainly are not. Do not read `question: null` as "system-derived".

**Their `isMatchingParam` flag is misnamed — do not copy the name.** Verified live: 34 of 92 fields are `true`, and they include `firstName`, `lastName`, `email`, `phone`. A surname cannot feed a match score. Meanwhile the entire `company` block has **zero** matching params despite a `company` ranker existing in the scoring payload. The flag marks required/core profile fields, not match inputs.

Our version should split it into two honest booleans:

```
is_required        -- must be filled for the profile to be usable
is_matching_input  -- actually read by one of the rankers in §5.2
```

Per-block `isMatchingParam: true` counts as observed: personalDetails 5, workEligibility 5, workPreferences 7, professionalProfile 8, company 0, career 9.

### 3.2 Schema

```sql
CREATE TABLE profile_blocks (
  key         TEXT PRIMARY KEY,     -- personalDetails | workEligibility | ...
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE profile_fields (
  field_key        TEXT PRIMARY KEY,
  block_key        TEXT NOT NULL REFERENCES profile_blocks(key),
  category_key     TEXT NOT NULL,          -- UI tab within the block
  category_uuid    TEXT,                   -- they carry this too
  field_type       TEXT NOT NULL,          -- string|number|boolean|string_array|object_array
  question         TEXT,                   -- plain English, shown as the label. NULLABLE (7/92 are null).
  options_json     TEXT NOT NULL DEFAULT '[]',
  is_multi_select  INTEGER NOT NULL DEFAULT 0,
  is_required      INTEGER NOT NULL DEFAULT 0,   -- what their isMatchingParam actually means
  is_matching_input INTEGER NOT NULL DEFAULT 0,  -- what the name implies; we track it honestly
  storage_target   TEXT NOT NULL DEFAULT 'FIELD_VALUE',  -- only value ever observed
  sort_order       INTEGER NOT NULL
);

CREATE TABLE profile_values (
  field_key  TEXT PRIMARY KEY REFERENCES profile_fields(field_key),
  value_json TEXT,                          -- always JSON, even scalars
  updated_at TEXT NOT NULL
);

-- Aliases so an ATS question can resolve to a field without an LLM call.
CREATE TABLE profile_field_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  field_key  TEXT NOT NULL REFERENCES profile_fields(field_key),
  alias_text TEXT NOT NULL,                 -- normalized employer question text
  source     TEXT NOT NULL,                 -- 'seed' | 'learned'
  hit_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_alias_text ON profile_field_aliases(alias_text);
```

`profile_field_aliases` is **our addition, not theirs** — it is how we avoid an LLM call for questions we have seen before. Every time a human resolves an unmatched ATS question, write the normalized question text as a `learned` alias. The system gets cheaper every week.

### 3.3 Seed data

Seed the six blocks and the field set below. This is their exact taxonomy, minus fields Ben does not need. Full 92-field dump is in `notes/02-dcp-schema.md`.

Coverage note: all 92 `fieldKey` / `fieldType` / `question` / `categoryKey` values were captured. About a dozen enums were captured only as **counts**, not full value lists (`country` 249, `gender` 4, `raceEthnicity` 7, `sexualOrientation` 6, `veteranStatus` 4, `legalSetup` 20, `workAuthorization` 24, `relocationArea` 11, `searchMotivation` 11, `searchTrigger` 6, `workStatus` 4). Where a list below ends in `...`, re-pull that field before seeding.

**Block `workEligibility`** (all matching params):

```
legalSetup        string_array  "Which work options are you open to?"
    US_FULL_TIME_EMPLOYEE_W2 | US_INDEPENDENT_CONTRACTOR_1099 | US_EMPLOYER_OF_RECORD | US_OWN_REGISTERED_COMPANY
residenceCountry  string        (ISO-3, 249 options)
workAuthorization string_array  "What is your current work authorization status in US?"
    US_CITIZEN | US_PERMANENT_RESIDENT | US_VALID_WORK_VISA | US_STUDENT_VISA_OPT_CPT | US_OTHER_WORK_AUTH | US_NOT_AUTHORIZED
visaSponsorship   string        "Will you require visa sponsorship to work in the U.S.?"
workingOutside    string_array  EU | US | UK | CANADA | LATAM | GLOBAL_REMOTE_ONLY
```

**Block `workPreferences`** (the pay-floor enforcement lives here):

```
baseSalary                number  M  "What's your minimum expected salary?"     -> 60000
baseSalaryPeriod          string  M  HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY         -> YEARLY
employmentType            string_array M  FULL_TIME|PART_TIME|CONTRACT_FREELANCE|INTERNSHIP
workFormat                string_array M  REMOTE|HYBRID|ON_SITE
relocationReadiness       string  M  YES|NO|DEPENDS_ON_LOCATION
relocationArea            string_array M  US_OPEN_WITHIN_STATE|US_OPEN_ANYWHERE_US|NOT_OPEN|OPEN_ANYWHERE_WORLDWIDE
noticePeriod              string     AVAILABLE_NOW|TWO_WEEKS|ONE_MONTH|TWO_MONTHS|THREE_MONTHS_PLUS
schedule                  string     FLEXIBLE|FIXED_NO_OVERTIME|FIXED_WITH_OVERTIME|NO_NIGHT_SHIFTS
benefits                  string_array  FLEXIBLE_PTO|HEALTH_INSURANCE|GYM_WELLNESS|LEARNING_BUDGET|
                                        PAID_TIME_OFF|HOME_OFFICE_BUDGET|EQUIPMENT_PROVIDED|
                                        RETIREMENT_PLAN|PARENTAL_LEAVE|STOCK_OPTIONS|SIGN_ON_BONUS
daysInOffice              number     1|2|3|4
percentageOfTravel        number
specificRemoteRequirements string_array FULLY_EQUIPPED|NEED_LAPTOP|NEED_FULL_SETUP
workingHoursOverlapStartDate / EndDate  string
oteMin / variableSalary*  number/string  (bonus + commission structure)
```

**Block `professionalProfile`:**

```
seniorityLevel      string  M  NO_SKILLS|ENTRY_WITH_DEGREE|JUNIOR|MIDDLE|SENIOR|LEAD_MANAGER|DIRECTOR|VP_EXECUTIVE_C_SUITE
academicLevel       string  M  NO_FORMAL|HIGH_SCHOOL_GED|ASSOCIATE_DEGREE|BACHELOR|MASTER|PROFESSIONAL_DEGREE|DOCTORAL
fieldOfStudy        string_array M
institutionName     string
leadershipExperience boolean M
leadershipScope     string_array  STANDARD_TEAM|DISTRIBUTED_REMOTE|DIVERSE_INTERNATIONAL|LEADING_LEADERS
numberOfDirectReports string  1-5|6-15|16-50|50-100|100+
yearsInLeadership   number
processesAndMethodologies string_array  ADAPT_TO_EVERYTHING|AGILE_SCRUM_KANBAN|WATERFALL|
                                        TARGET_DRIVEN_KPI_OKR|DESIGN_THINKING|LEAN|NONE
technicalToolbox    string_array M
portfolioWebsites   string_array
workLanguage        object_array M
st_hardSkills              object_array M  [taxonomy-backed]
st_softSkills              object_array
st_jobTitles               object_array    [desired titles]
st_workExperiences         object_array    [structured employment history]
st_industryDomainKnowledge object_array M  [taxonomy-backed]
st_professionalCredential  object_array    [certs, licenses, memberships]
```

The `st_` prefix means the value is an array of taxonomy entities `{uuid, name, level}`, not strings.

**Block `personalDetails`** — 27 fields including the US EEO set (`gender`, `raceEthnicity`, `veteranStatus`, `disabilityStatus`, `lgbtqCommunity`, all with a `PREFER_NOT_TO_SAY` option). These exist for exactly one reason: auto-answering the voluntary-disclosure section every US application has. Seed Ben's per `CLAUDE.md`: veteran YES, disability YES, ethnicity never answered, race undisclosed.

**Block `company`** — culture/team fit: `companyMaturityFit` (CLEAR_PROCESSES_STABLE → BUILD_FROM_SCRATCH, 6 levels), `teamSetup`, `teamSize`, `culturalDiversityExperience`, `areaOfInterest`.

**Block `career`** — motivation and urgency: `jobSearchDuration`, `jobSearchIntensity` (ACTIVELY_APPLYING|OPEN_BUT_SELECTIVE|JUST_EXPLORING), `personalDeadline` (ASAP|WITHIN_2_3_MONTHS|THIS_YEAR_SOONER|NO_DEADLINE), `searchTrigger`, `searchMotivation`, `motivationFit`, `developmentFocus`, `dreamCompany`, `workStatus`, `careerAspiration`.

> `desperateScore` and `internalSeniorityScore` both have `question: null` and look system-derived (INFERRED — five other fields including `nationality` also have null questions and are clearly user-supplied, so null does not by itself mean computed). Skip `desperateScore`; it exists to tune their upsell pricing. `internalSeniorityScore` is worth keeping as a derived field.

### 3.4 Completion endpoint

```
GET /api/v1/profile/completion
-> { score: 0-100, blocks: { <blockKey>: { filledCount, totalCount } } }
```

Render as cards with a strength bar. Trivial, and it is the only thing that reliably gets a profile filled in.

---

## 4. Taxonomy service

```sql
CREATE TABLE taxonomy_skills (
  uuid TEXT PRIMARY KEY, lightcast_id TEXT, name TEXT NOT NULL,
  name_normalized TEXT NOT NULL, level INTEGER DEFAULT 0
);
CREATE TABLE taxonomy_titles     (uuid TEXT PRIMARY KEY, name TEXT NOT NULL, name_normalized TEXT NOT NULL, level INTEGER DEFAULT 0);
CREATE TABLE taxonomy_industries (uuid TEXT PRIMARY KEY, name TEXT NOT NULL, name_normalized TEXT NOT NULL);
CREATE INDEX idx_skill_norm ON taxonomy_skills(name_normalized);
```

The `lightcastId` field is present on every skill record (verified), empty on user-created entries — so **Lightcast Open Skills seeding is a strong inference, not a confirmed fact**. Note the public Lightcast library is roughly 33k skills while their table is 344k, so whatever they seeded from, it is not Lightcast alone.

Live counts read from `meta.totalRecords`, and they moved during the teardown session — 344,106 → 344,293 skills, 23,996 → 24,012 titles, 700 industries — which confirms these are live reads and that the corpus grows continuously.

Note the deliberate asymmetry: skills are ontology-anchored, titles are free-entry with dedupe (their titles table visibly contains junk entries named `?` and `???`). Copy the asymmetry. Titles are messy in the real world and forcing a taxonomy on them creates more problems than it solves.

For Ben's use, seed only skills relevant to data/analytics roles — a few thousand rows, not 344k.

**Constraint:** the resume skill list still comes from `Resume Standards` rule 6 only. Taxonomy is for *matching* against job postings, not for deciding what goes on the resume. Keep two separate concepts:
- `taxonomy_skills` — the vocabulary used to compare Ben to a posting.
- `resume_skills` — the fixed allowlist that may appear in a rendered document.

---

## 5. Job ingestion and the match pipeline

### 5.1 Job entity

```sql
CREATE TABLE jobs (
  uuid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_uuid TEXT,
  job_url TEXT NOT NULL,
  apply_url TEXT,
  board TEXT,                     -- greenhouse|workable|workday|zoho|applytojob|lever|...
  ats_uuid TEXT,
  status TEXT DEFAULT 'ACTIVE',
  created_at TEXT, time_posted TEXT, has_expired INTEGER DEFAULT 0,
  level TEXT, type TEXT,
  -- seniority classification of the JOB, compared against the candidate's
  seniority_track TEXT,           -- individual_contributor | manager | executive
  seniority_ic_type TEXT,         -- entry | junior | middle | senior
  seniority_years_required INTEGER,
  year_experience INTEGER,
  education TEXT,
  employment_json TEXT,           -- {engagementType[],timeCommitment[],duration,isInternship,isVolunteer}
  compensation_json TEXT,         -- {baseSalary{min,max,currency,period},oteSalary,variableCompensation{...}}
  rate_hourly_min REAL, rate_hourly_max REAL, rate_unit TEXT,
  locations_json TEXT,            -- [{country,state,city,continentRegion}]
  skills_json TEXT,
  description TEXT, description_html TEXT,
  allow_auto_apply INTEGER DEFAULT 0,
  scam_score INTEGER DEFAULT 0,
  duplicate_cluster_id TEXT,
  is_favorite INTEGER DEFAULT 0, is_viewed INTEGER DEFAULT 0, is_applied INTEGER DEFAULT 0
);
```

Two fields worth calling out because they are not obvious and they matter:

- **`scam_score`** (0–2 observed). Score every posting for fraud signals: no company domain, salary far above band, vague description, contact email on a free provider, reposted more than N times. Cheap heuristic, high value.
- **`duplicate_cluster_id`**. The same job appears on Greenhouse and LinkedIn and an aggregator. Cluster on `normalize(company) + normalize(title) + location` and show one card. GlobalWork returns `duplicateUuids[]` on every job.

### 5.2 The two-stage match pipeline — copy this exactly

GlobalWork returns both stages' telemetry to the client:

```json
"retrievalMeta": { "score": 4.926803, "index": 5 },
"rankMeta": {
  "relevanceScore": 0.8988,
  "totalScore": 0.9586,
  "index": 0,
  "rankerScores": {
    "skills":       { "score": 0.941,  "missingData": [] },
    "experience":   { "score": 0.9801, "missingData": [] },
    "compensation": { "score": 1,      "missingData": [] },
    "terms":        { "score": 1,      "missingData": [] },
    "company":      { "score": 1,      "missingData": [] }
  }
}
```

**Stage 1 — retrieval.** Unbounded score (BM25 or embedding cosine). Pull a candidate set of ~200 from the whole job corpus. Record `retrievalMeta.index`.

**Stage 2 — rerank.** Five independent scorers, each returning `0..1` plus a `missingData: string[]` naming the profile fields that blocked a confident score. Combine into `totalScore`; that is the "% match" on the card. In the observed data a job that ranked 6th on retrieval ranked 1st after reranking, which is the entire point.

Implement the five rankers as pure functions over enums. No LLM in this path.

```
skills(profile, job)       Jaccard / weighted overlap of taxonomy skill UUIDs.
                           Weight must-have skills from the JD higher than nice-to-have.
experience(profile, job)   Compare profile.seniorityLevel and years against
                           job.seniority_ic_type and seniority_years_required.
                           Penalize overqualification less than underqualification.
compensation(profile, job) job.baseSalary.max vs profile.baseSalary.
                           HARD FLOOR: score 0 if job max < 54000. Flag 54000-60000.
terms(profile, job)        workFormat, schedule, location, employmentType, relocationArea.
                           Set intersection. Mostly 1.0 or 0.0.
company(profile, job)      companyMaturityFit, teamSize, industry, dreamCompany list.
                           Ben-specific: veteran-friendly employer flag, federal/GS flag.
```

### 5.3 Their exact weighting — solved, not guessed

Fitted against 16 real jobs pulled from the live endpoint (120 returned). Mean absolute error below 0.0002, which is a fit, not a guess:

```
core       = 0.55 * skills + 0.45 * experience
totalScore = core * (0.91 + 0.09 * compensation)
```

Worked samples (`total` | `0.55·sk + 0.45·ex` | `compensation` | residual):

```
0.9887   0.9887   1.0000   -0.0000
0.9586   0.9586   1.0000   +0.0000
0.8699   0.8699   1.0000   +0.0000
0.4185   0.4185   1.0000   -0.0000
0.4050   0.4051   1.0000   -0.0001
0.8157   0.8964   0.0000   -0.0807   <- gate fires
0.7332   0.7559   0.6667   -0.0227   <- gate fires
0.6550   0.7198   0.0000   -0.0648   <- gate fires
```

Applying the 0.09 gate resolves every residual to zero.

**Three findings that change how you build this:**

1. **`relevanceScore` contributes nothing to `totalScore`.** Fitted weight: −0.00. It is a separate diagnostic. My earlier annotation calling it "skills + experience only" is refuted by the data — `relevanceScore` sits *below* both rankers on every sample (skills 0.985, experience 0.9933, relevance 0.8166), which no weighted average can do. Treat it as an opaque stage-1 signal.

2. **Compensation is only a 9% multiplicative gate.** A job whose pay is a total mismatch scores `compensation: 0` and still keeps 91% of its match. One job in the live feed reads **82% match with `compensation: 0`**. Only 7 of 120 jobs had any gate below 1.0.

3. **`terms` and `company` are 1.0 on all 120 jobs**, so their weights are unidentifiable. Assume the same `(0.91 + 0.09·x)` shape until proven otherwise.

**Deviate deliberately on compensation.** Ben has a $54K hard drop and a $60K floor. A 9% haircut is the wrong instrument. Use:

```
core  = 0.55*skills + 0.45*experience
gates = (0.7 + 0.3*terms) * (0.85 + 0.15*company)
total = core * gates * comp_multiplier

comp_multiplier:
  job.baseSalary.max < 54000                -> 0.0    hard drop, row is dead
  54000 <= job.baseSalary.max < 60000       -> 0.6    surfaced, flagged "negotiation candidate"
  job.baseSalary.max >= 60000               -> 1.0
  salary not disclosed                      -> 0.85   penalize, do not eliminate
```

Store `recommendation_request_id` on every batch and on every resulting application, then tune against Ben's real applications and replies using the calibration panel in §9.

**Scale:** the API returns `0..1`; the band copy in §5.4 resolves on `0..100`. The ×100 happens client-side. Verified against the UI: `totalScore` 0.9586 renders as "96% match", 0.8699 as "87%", 0.8683 as "87%".

**Reranking genuinely reorders.** Observed `retrievalMeta.index → rankMeta.index` (0-based): `0→0`, `5→1`, `25→2`, `4→3`. A job ranked 26th on retrieval finished 3rd.

### 5.4 Explainability — their copy table, verbatim

This is in `code/match-score-bands.ts`. Use it directly; the wording is already good and rewriting it wastes time.

```
skills       90-100 "You've got all the key skills this role is looking for"
             75-89  "You have most of the key skills this role needs"
             55-74  "You have about half the key skills for this role"
             0-54   "Most of the must-have skills for this role aren't a match"

experience   90-100 "Your experience level and work history are a great fit for this role"
             75-89  "Your experience is a good fit for what this role needs"
             55-74  "Your background is relevant, even if it's not a perfect fit"
             0-54   "Your experience is a bit far from what this role is looking for"

compensation 95-100 "The pay here meets or beats what you're looking for"
             80-94  "A little under your target, but still in a comfortable range"
             60-79  "Pay comes in a bit below your target"
             0-59   "This role likely won't meet your pay expectations"

terms        90-100 "Work style, schedule and location all match what you're after"
             60-89  "Mostly a fit, with a small difference in the work setup"
             0-59   "The format, schedule or location doesn't line up with your preferences"
```

Headline color: `score > 80 ? success : caution`. Note they compute five rankers and display four — `company` is hidden. Display all five; Ben is the only user and there is no reason to hide a signal from him.

`missingData[]` is the mechanism behind "improve your profile to improve matches". When a ranker can't score confidently, it names the specific field. Surface it as a deep link straight to that profile field, not a generic nag.

---

## 6. ATS form mirror — the core feature

This is what the product actually is, and it is the part most people get wrong by trying to drive the browser live.

### 6.1 What they do

```
GET /api/v1/auto-apply/applications/{uuid}/details
{
  applicationUuid, jobUuid, publicStatus, needManualApply, done, submittedAt,
  cv: {uuid, title, status},
  coverLetter: {uuid, title, status},
  job: {...},
  sections: [{
    section: "other",
    fields: [{ uuid, type, label, value, options[], required, placeholder, order }]
  }]
}
```

They scrape the employer's form once, persist it as structured field rows, and **re-render it natively inside their own UI**. Observed on a real Greenhouse application: 18 fields with the employer's verbatim labels, a 248-option phone country-code select, correct `required` flags, original ordering, and `value` populated with AI-written answers on free-text questions like "Please rank the top 3 skill sets that you'd like to further develop at YipitData".

### 6.1a Their prefill fails on exactly one thing, and it is the thing to beat them at

Verified breakdown of that same 18-field application:

```
type            count   prefilled
text              7        7
textarea          2        2
checkboxGroup     1        1
select            8        0      <-- every single one empty
                 --       --
                 18       10
```

**All 10 successes are free text. All 8 failures are `select` fields** — questions whose answer must land on an employer-supplied option list. That is the "8" badge on the Apply form tab and the entire reason the application sits in `actionRequired`. The city autocomplete was *not* resolved; it rendered "Select..." with "Field is required".

Their generator writes prose well and cannot map a value onto someone else's enum. Ben's profile is already stored as controlled enums, so for him this is a **lookup table, not a generation problem** — see step 3 of §6.3. Get that right and the system clears applications theirs cannot.

Full field type union — **from client bundle fixtures, not from an observed API response**. Only `text`, `textarea`, `select` and `checkboxGroup` have been seen in a live `/details` payload; treat the rest as the renderer's capability, not a confirmed server enum:

```
text | textarea | number | date | file | select | autocomplete
| radio | radioGroup | checkbox | checkboxGroup | dialog | skills
```

Only one `section` value has ever been observed: the literal `"other"`. The plural `sections[]` is their shape, not a demonstrated multi-section mirror.

Write path (**bundle-derived, never exercised** — nothing was submitted during this teardown, and the `applying` transition is a client-side optimistic update, not an observed server response):

```
PATCH /auto-apply/applications/{uuid}/job-forms   { fields: [{ jobFieldUuid, value }] }
POST  /auto-apply/applications/{uuid}/approve     -> publicStatus becomes 'applying'
```

Note the read shape keys the field as `uuid` while the write shape calls it `jobFieldUuid`. Assume they are the same identifier; that round trip was not tested. A collection-level `POST /auto-apply/applications/approve` also exists for bulk approval.

The client polls `/details` on an interval while `publicStatus` is `preparing` or `applying`.

### 6.2 Schema

```sql
CREATE TABLE applications_v2 (
  application_uuid TEXT PRIMARY KEY,
  job_uuid         TEXT NOT NULL REFERENCES jobs(uuid),
  ats_uuid         TEXT,
  supported_ats    INTEGER NOT NULL DEFAULT 0,
  public_status    TEXT NOT NULL,   -- preparing|readyToApply|applying|applied|actionRequired|failed|expired
  need_manual_apply INTEGER DEFAULT 0,
  cv_uuid          TEXT REFERENCES cvs(uuid),
  cover_letter_uuid TEXT REFERENCES cover_letters(uuid),
  recommendation_request_id TEXT,
  match_total_score REAL,
  match_ranker_scores_json TEXT,
  submitted_at TEXT, parsed_at TEXT, matched_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  legacy_application_id INTEGER REFERENCES applications(id)   -- bridge to the existing table
);

CREATE TABLE application_form_fields (
  uuid             TEXT PRIMARY KEY,
  application_uuid TEXT NOT NULL REFERENCES applications_v2(application_uuid),
  section          TEXT NOT NULL DEFAULT 'other',
  field_type       TEXT NOT NULL,
  label            TEXT NOT NULL,      -- employer's verbatim question
  label_normalized TEXT NOT NULL,      -- for alias matching
  value            TEXT,
  options_json     TEXT NOT NULL DEFAULT '[]',
  required         INTEGER NOT NULL DEFAULT 0,
  placeholder      TEXT,
  sort_order       INTEGER NOT NULL,
  fill_source      TEXT,               -- 'profile:<fieldKey>' | 'alias' | 'llm' | 'human'
  fill_status      TEXT NOT NULL,      -- filled | skipped | needs_human
  validation_message TEXT
);
```

`fill_source` is **our addition**. Track how every answer got there. It is the only way to know whether the alias table is actually saving LLM calls, and it makes the "why did it say that" question answerable.

### 6.3 The fill algorithm

For each scraped field, in order, stop at first hit:

1. **Direct profile map.** Hand-written map from `label_normalized` to `field_key` for the ~40 questions that appear on nearly every application (name, email, phone, address, work authorization, sponsorship, veteran, disability, gender, race, LinkedIn, salary expectation, start date, willingness to relocate).
2. **Learned alias.** Look up `label_normalized` in `profile_field_aliases`. Bump `hit_count`.
3. **Enum coercion. This is the step that beats them.** If the field is a `select`, `radio`, `radioGroup` or `checkboxGroup` and the resolved profile value is an enum, map it onto the employer's option list. `US_CITIZEN` → "Yes, I am authorized to work in the United States". `BACHELOR` → "Bachelor's Degree". Build a per-enum synonym table, fall back to normalized fuzzy match against `options[]`, and require a confidence threshold before accepting. Recall from §6.1a that GlobalWork prefills **zero** select fields — this step is the whole differentiator, so give it real effort and log every miss as a synonym-table gap.
4. **LLM generation.** Only for genuinely open questions ("Why do you want to work here", "Explain any gaps in your work history"). Prompt with: the job description, the tailored resume, `voice.md`, and the hard rules. Cache by `hash(label_normalized + job_uuid)`.
5. **Mark `needs_human`.** Set `public_status = 'actionRequired'` and surface the field. When Ben answers it, write a `learned` alias so it never comes back.

Step 5 is what GlobalWork does and it is the right call. Their `invalidFields[]` returns `{status: "skipped", label: "<verbatim question>"}` and the UI says "We need a few more details to continue". **Never guess on a required field.** A wrong answer to "Are you legally authorized to work in the United States" is worse than an unfinished application.

### 6.4 Scraping

GlobalWork supports greenhouse, workable, workday, zoho, applytojob server-side and falls back to `needManualApply` for everything else — they do not pretend to handle every ATS.

For Ben, invert the priority. Chrome MCP is already wired up and running locally on his machine with his real session cookies, which is *more* capable than their headless scraper for the sites that matter. Build:

- **Per-ATS adapters** for greenhouse, lever, workable, workday, icims, ashby, jazzhr. Each adapter is a DOM selector map that produces `AtsField[]`. Start with greenhouse and lever; they cover the majority of Ben's real applications.
- **A generic fallback adapter** that walks the form, reads `<label for>` / `aria-label` / adjacent text, and infers `type` from the input element. Works surprisingly well and is the only way to cover the long tail.
- **A snapshot in R2** of the raw form HTML per application, so a failed parse can be replayed and fixed offline instead of re-fetched.

Submission stays a **two-step, human-gated action**: render the filled form in the dashboard → Ben clicks Approve → Chrome MCP replays the values into the live page and clicks submit → screenshot the confirmation into R2 as proof. Do not auto-submit without approval. Ben's `CLAUDE.md` already forbids entering passwords/SSNs; the approve gate is the enforcement point for everything else.

---

## 7. Documents: CV and cover letter

### 7.1 The key structural insight

**A CV is a versioned document keyed to a `jobUuid`.** Confirmed live: `GET /api/v1/cv` returns **28 records** — 1 with `type: "DEFAULT"`, `jobUuid: null`, `isDefault: true`, and **27 with `type: "TAILORED"`, each carrying a `jobUuid`**. The Resumes screen only surfaces the default, which is why this is invisible from the UI.

```
base CV       : type='DEFAULT',  job_uuid=NULL,  is_default=1
tailored CV   : type='TAILORED', job_uuid=<job>
```

Because both documents always exist, you can compute a diff. That is what makes their single best UX feature possible.

**They have no parent pointer.** The observed CV entity has no `parentUuid` — their diff must run against whichever row has `isDefault: true`. The `parent_uuid` column below is **our addition**, and it is worth having: it pins each tailored CV to the exact base revision it was generated from, so a diff stays correct after Ben edits his base resume.

```sql
CREATE TABLE cvs (
  uuid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  job_uuid TEXT REFERENCES jobs(uuid),        -- NULL on the base
  parent_uuid TEXT REFERENCES cvs(uuid),       -- OUR addition; GlobalWork has no parent pointer
  type TEXT NOT NULL,                          -- DEFAULT | TAILORED
  status TEXT NOT NULL,                        -- PENDING|PROCESSING|COMPLETED|FAILED
  personal_details_json TEXT,
  professional_title TEXT,
  professional_summary TEXT,
  employment_history_json TEXT,   -- [{title,employer,startDate,endDate,city,description}]
  education_history_json TEXT,    -- [{title,school,degree,startDate,endDate,description,city}]
  skills_json TEXT,               -- {isHidden,data:[{uuid,title,level}],suggested:[]}
  social_links_json TEXT, courses_json TEXT, languages_json TEXT,
  custom_sections_json TEXT, references_json TEXT,
  template TEXT, color TEXT,
  pdf_r2_key TEXT,
  verify_passed INTEGER,          -- verify_resume.py gate result
  verify_report TEXT,
  created_at TEXT, updated_at TEXT
);
```

Every section carries an `isHidden` flag. Skills carry `level: number` and a `suggested[]` array the generator populates but the human approves.

Async generation, following their shape: `POST /cv/process/v2` returns immediately with `status: PROCESSING`, client polls `GET /cv/{uuid}/processing`. Their AI endpoints are granular rather than one big "rewrite my resume" call:

```
POST /cv/phrases/ai                     rewrite a single bullet
POST /cv/text/ai                        rewrite an arbitrary block
POST /cv/{uuid}/professional-summary/ai regenerate just the summary
```

Copy that granularity. Field-level regeneration is what makes the editor usable.

### 7.2 The redline diff — build this

**Their single best UX decision.** The tailored resume is rendered as a tracked-changes diff against the base: green = added, red = removed, with a "Use original" toggle to revert. Same treatment on the cover letter, where AI-generated phrases are highlighted.

Ben is not asked to trust a black box that rewrote his resume. He sees every word that changed, inline, before he submits. Given his hard rules (no em dashes, no AI as a skill, fixed skill allowlist, exact phrasing for Closing Day and the $36M figure), a visible diff is not a nicety — it is the compliance mechanism.

Implementation: word-level diff (`diff-match-patch` or `jsdiff`) per section between `parent_uuid` and the tailored version. Render as `<ins>` / `<del>`. Wire the existing `verify_resume.py` gate to run on the tailored version and **block PDF delivery on non-zero exit**, surfacing `verify_report` next to the diff.

### 7.3 Rendering

Keep the existing pipeline: HTML → weasyprint → PDF, `design-spec-v2.css`, filename `CompanyName Position Whetstone Resume.pdf`, PDF only, never .docx. The change is that it renders from `cvs` rows instead of from a prose blob.

Their `sharedHash` / `sharedViews` fields give every CV a public share link with a view counter. Cheap to add, genuinely useful for a portfolio link in an application.

---

## 8. The relay inbox

**This is the sharpest architectural idea in the product and it is worth serious thought.**

```json
GET /api/v1/email/accounts
{ "provider": "managed", "address": "<handle>@envelopad.com",
  "status": "active", "priority": 1, "blockedAts": [] }
```

Every application is submitted with a **platform-controlled address on a dedicated domain**, not the user's real email. That means:

- Every recruiter reply, rejection, and interview request lands in a mailbox they own.
- No Gmail OAuth, no IMAP credentials, no Google API scope review, no token refresh.
- Reply-rate analytics come free, because they see the whole conversation.
- Classification into Updates / Rejections / Interviews / Offers is just a classifier over their own inbox.

The catch, worth naming: they own the channel. Cancel the subscription and the thread history goes with it. Building it for yourself removes that objection entirely.

**For Ben:** he owns `benwhetstone.info`. Set up Cloudflare Email Routing on a subdomain — `apply@jobs.benwhetstone.info` or per-application addresses `<app-id>@jobs.benwhetstone.info` — routed into a Worker.

Per-application addressing is the better version of their design: the moment an email arrives you know exactly which application it belongs to, with zero matching heuristics. GlobalWork uses one address per user and has to infer.

```sql
CREATE TABLE email_messages (
  uuid TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  application_uuid TEXT REFERENCES applications_v2(application_uuid),
  direction TEXT NOT NULL,           -- inbound | outbound
  from_address TEXT, to_address TEXT,
  subject TEXT, body_text TEXT, body_html TEXT,
  category TEXT,                     -- update | rejection | interview | offer | other
  category_confidence REAL,
  is_read INTEGER DEFAULT 0,
  received_at TEXT NOT NULL,
  raw_r2_key TEXT
);
```

Classifier: rules first (subject contains "unfortunately", "not moving forward", "schedule", "interview", "offer"), LLM only on the residue. GlobalWork's buckets are `All | Updates | Rejections | Interviews | Offers` — that is the right set.

**Ben-specific requirement:** he has standing permission to retrieve email verification codes from Gmail. The relay Worker should detect 4–8 digit codes in inbound mail and surface them to the Cowork session so ATS 2FA does not stall an application.

---

## 9. Analytics

Three panels, all backed by SQL over the tables above.

**Funnel** with market benchmarks. Their exact response:

```json
[{"stage":"applied",    "count":24, "conversion":null, "marketAvg":null},
 {"stage":"replies",    "count":5,  "conversion":20.8, "marketAvg":3.5},
 {"stage":"interviews", "count":0,  "conversion":0,    "marketAvg":45},
 {"stage":"offers",     "count":0,  "conversion":0,    "marketAvg":26}]
```

Read those benchmarks as: 3.5% of applications get a reply, 45% of replies become interviews, 26% of interviews become offers. Whether their numbers are accurate is unknown, but **showing a benchmark next to a rate is what makes the number actionable**. Ben is at 20.8% reply on 24 applications, roughly 6x their stated average — that is a finding he could not get from a raw count.

**Activity tracker.** A 30-day grid, buckets `0 / 1-5 / >5` applications per day, plus current streak and most-active weekday. Pure behavior nudge, and it maps directly onto Ben's Four Pillars / "Lean" accountability framing.

**Salary alignment.** Expected salary vs the distribution of salaries on jobs actually applied to. Their endpoint is `/salary-stats/chart`.

Add one they don't have, because Ben has the data and they don't:

**Ranker calibration.** Group applications by `match_total_score` decile and show actual reply rate per decile. If 90%+ matches don't reply more than 60% matches, the weights in §5.2 are wrong. This closes the loop that `recommendation_request_id` exists to enable.

---

## 10. Application state machine

```
        ┌──────────────────────────────────────────────┐
        v                                              │
  [discovered] ──match──> [preparing] ──forms ok──> [readyToApply]
                              │                          │
                     missing required                 approve
                              v                          v
                       [actionRequired] ──human──> [applying] ──> [applied]
                                                       │
                                                    error
                                                       v
                                                    [failed]

  any state + posting closed -> [expired]
```

Their exact enum, keep it: `preparing | readyToApply | applying | applied | actionRequired | failed | expired`.

Client polls `/details` while status is `preparing` or `applying`.

The dashboard summary counts every state:
```
GET /api/v1/applications/summary
-> { actionRequired, readyToApply, applying, preparing, applied, expired, failed }
```

Map onto the existing `applications.status` column (`in_progress | submitted | interview | offer | rejected | withdrawn`) rather than replacing it — the old column tracks the *outcome*, the new one tracks the *pipeline*. Both are needed. Keep `status_locked` / `notes_locked` / `hidden` semantics intact; they exist because Ben edits rows by hand and automation must not stomp him.

---

## 11. Build order

**Phase 1 — Profile engine.** `profile_blocks` / `profile_fields` / `profile_values` / `profile_field_aliases`. Seed the six blocks and Ben's values. Build the block editor (categories as tabs, `question` as label) and the completion endpoint. *Nothing else works without this.*

**Phase 2 — Job ingest and match.** `jobs` table, dedup clustering, `scam_score`. Port the existing sweep skills to write here instead of to markdown. Implement the five rankers as pure functions plus the band copy from `code/match-score-bands.ts`. Ship the ranked job list with the expandable breakdown.

**Phase 3 — Documents.** `cvs` / `cover_letters` with `job_uuid` versioning. Wire the existing weasyprint pipeline to render from rows. Build the redline diff view. Wire `verify_resume.py` as a hard delivery gate.

**Phase 4 — ATS mirror.** `application_form_fields`. Greenhouse and Lever adapters first, generic fallback second. The 5-step fill algorithm. The `actionRequired` UI. Chrome MCP replay with an approve gate and a confirmation screenshot into R2.

**Phase 5 — Relay inbox.** Cloudflare Email Routing on `jobs.benwhetstone.info`, per-application addresses, Worker ingest, rules-then-LLM classifier, threaded UI with reply. Verification-code extraction.

**Phase 6 — Analytics.** Funnel with benchmarks, activity tracker, salary alignment, ranker calibration.

Phases 1 and 2 alone replace most of what the sweep skills currently do by hand.

---

## 12. What to deliberately not copy

- **The 2.6 MB single JS bundle.** No code splitting, no lazy routes. Don't.
- **The growth stack.** Their authenticated app loads Snapchat, TikTok, LinkedIn Insight, Reddit, Google Ads, Bing UET, Microsoft Clarity, Cookiebot, and Amplitude. On a dashboard you already paid for.
- **Two state libraries.** They run Zustand *and* redux-persist *and* TanStack Query. Pick TanStack Query for server state and useState for the rest.
- **The `desperateScore` field.** They compute how badly you need a job. That exists to price the upsell.
- **The quota.** 100 applications/month is a paywall lever, not a product feature.
- **Five simultaneous A/B control groups.** (`userControlGroup`, `userSubControlGroup`, and three dashboard variants.) One user, no experiments.
- **Hiding a ranker from the user.** They compute `company` and don't show it.

---

## 13. Open questions to resolve during Phase 1

1. Does Ben want per-application relay addresses (better attribution, more DNS setup) or one shared address (simpler)? Recommendation: per-application.
2. Seed the full Lightcast Open Skills set or just the data/analytics subset? Recommendation: subset, ~2–3k rows, expand on demand.
3. Should the tailored CV auto-generate on match, or only on "Prepare application"? GlobalWork does it on prepare. Recommendation: match theirs; generating 120 resumes per sweep is waste.
4. Where does `hiring-manager-gate` (Marcus) sit? Recommendation: between diff-approval and form-fill, writing a pass/revise/reject verdict onto `applications_v2`.

---

## Appendix: verified vs inferred

Rewritten after the adversarial verification pass. Full detail in `notes/04-CORRECTIONS-and-scoring-formula.md`.

**Verified — observed in a live authenticated API response.** All 50 endpoint paths. The DCP structure: 92 fields, 6 blocks, per-block counts, all `fieldKey`/`fieldType`/`question`/`categoryKey` values, the ten-key field object, `isMatchingParam` true on exactly 34 fields, `question` null on exactly 7. The job entity and both telemetry blocks. **The scoring formula `0.55·skills + 0.45·experience`, gated by `(0.91 + 0.09·compensation)`, fitted to 16 samples at <0.0002 error.** `totalScore × 100` = the card percentage, checked against three UI values. The application state enum and summary counts. The `/details` form mirror shape, and the 18-field prefill breakdown (10 free-text filled, 8 selects empty). 28 CV records with `type` values `DEFAULT` and `TAILORED`, 27 carrying a `jobUuid`. The relay account: `provider: "managed"` on `envelopad.com`. The `lightcastId` field. All three taxonomy `totalRecords`, twice, showing drift. Subscription pricing and SolidGate. Funnel benchmarks. Quota. The band copy in `match-score-bands.ts` (bundle source).

**Verified from bundle source only, not from an API response.** The 13-value ATS field type union — only `text`, `textarea`, `select`, `checkboxGroup` appear in a live payload. The `PATCH .../job-forms` request body. The `approve` → `applying` transition, which is a client-side optimistic update.

**Inferred.** Lightcast Open Skills as the seed source (field name only; their table is ~10× the public library). The retrieval algorithm behind `retrievalMeta.score` — one sample at 4.93 shows only that it is not normalized to 0..1. Weights for the `terms` and `company` gates, which are 1.0 on all 120 jobs and therefore unidentifiable. What `relevanceScore` actually measures — confirmed only that it contributes **nothing** to `totalScore`. Server-side ATS scraping. `storageTarget` semantics beyond the single observed value. The `scamScore` scale beyond 0/1/2. That `desperateScore` and `internalSeniorityScore` are computed.

**Not observed.** Onboarding, paywall and plan-selection screens, the resume editor internals, an application in `readyToApply` or `applying`, an actual submission, a multi-section form mirror, the browser extension.
