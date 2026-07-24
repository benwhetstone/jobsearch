---
name: job-application-builder
description: >-
  Builds high-performing, ATS-optimized, results-forward resumes and cover letters for Ben Whetstone's
  data-analytics job search, then drives the online application in the browser. ALWAYS trigger this skill
  when Ben says "apply to this job", "build me a resume for", "tailor my resume", "write a cover letter for",
  "make a resume and cover letter", pastes or links a job posting, or asks to submit / fill out a job
  application. Also trigger on "apply for me", "customize my resume", "resume for [company/role]", or any
  request to produce or submit application materials. When in doubt and the request touches a resume, cover
  letter, or job application, use this skill.
---

# Job Application Builder

Generate a tailored, interview-winning resume and cover letter for a specific posting, then complete the
online application. Every output is engineered to clear the two 2026 gatekeepers — the keyword ATS and the
AI semantic ranker — and to read as a real, quantified, human document once a person sees it.

The guiding principle (from Ben's own research): **you win by changing HOW you apply, not by inventing
credentials.** Tailor to the posting, mirror its language, lead with quantified wins, and target fewer roles
with more effort.

---

## Step 0 — Check the tracker before doing anything else

The single most expensive failure mode in this workflow is not a bad resume — it's applying to the same
job twice. Duplicate applications land in a recruiter's inbox with Ben's name on them and make him look
disorganized, and he has no way to take them back.

Before opening a posting, before writing a resume, before touching a form:

1. Read `/Job Search/Tracking/job-search.json`.
2. If the company is already there as `"status": "submitted"` — stop, tell Ben it's done and when, and
   don't open the application.
3. If it's `"status": "in_progress"` — **don't treat that as permission to refill it.** An in-progress
   note is a claim, not evidence. Verify it (Step 0b) first.
4. Proceed only when the company is absent, or you've confirmed it's genuinely unfinished.

### Step 0b — A status is only as good as the evidence behind it

Mark something `submitted` only when you have one of:

- a confirmation email in **brwhetstone@gmail.com** — search the company name in the **Chrome Gmail tab**.
  The connected Gmail MCP is Ben's *work* account and will never contain these; or
- an "Application Submitted" confirmation page you observed on screen this session.

Without one of those, the status stays `in_progress`, and the note says exactly what's missing and who
has to do it — "needs Ben's reCAPTCHA + Submit click," not "almost done."

> This rule was written after Marrina Decisions received **three** applications. The tracker said "needs
> your reCAPTCHA + Submit." Nobody ever checked whether that was true, and the form got refilled twice
> more on the strength of that unverified note. Three confirmation emails, same recruiter, same day.

---

## Step 1 — Load Ben's fixed facts (never guess these)

Pull from `/Job Search/Misc/Resume Standards - Whetstone.md`, `/Job Search/Misc/Resume and Cover Letter Best Practices 2026.md`, and the Career Intake Profile (produced by the `career-counselor` skill) if present.

**Identity — these have been gotten wrong before and each error cost a correction round:**

- Legal name is **Benjamin** Whetstone; preferred name is **Ben**. Legal-name fields get *Benjamin*.
- **Protected veteran — self-identify Yes.** U.S. Army, Signal Support Systems Specialist (25U), 2000–2004.
- **Has a disability — self-identify Yes.**
- Ben is **not senior.** Don't surface, recommend, or apply to Senior / Lead / Principal / Manager roles.
- Location filter: in-person Tampa, hybrid Tampa, or fully remote **US-only**. Nothing else qualifies.
- Contact: 6514 Maiden Sea Dr, Apollo Beach, FL 33572 | 813-468-9832 | brwhetstone@gmail.com |
  data.benwhetstone.info | linkedin.com/in/benwhetstone

**Substance:**

- **Proof:** `data.benwhetstone.info` is Ben's portfolio and proof of every claim. Put it in the header and reference it. This IS the projects evidence — cite it; do not invent new projects.
- **Honest role accuracy:** Ben DESIGNS data models/schemas/specs and DIRECTS/MANAGES AI-assisted development. Never write that he personally coded/"built" the software.
- **Never** reference eXp Realty (the business is "The South Shore Team").
- **Clearance wording (only if relevant):** "Previously held U.S. Army Secret clearance, eligible for reinstatement." Never claim active.
- **Never** state total career years ("25 years"), age signals, or apologize for experience level. Lead with what he does, not what he is not.
- **Honest skill years / certs:** SQL, Power BI, T-SQL each ~1 yr and improving; Excel 10 yrs; Data Analysis 10 yrs. DP-900 earned July 2026. PL-300 and Tableau Desktop Specialist in progress. Google *Data Analytics Foundations* (not the full certificate). Never claim a tool he can't be interviewed on.
### The skill list is NOT yours to compose

`/Job Search/Misc/Resume Standards - Whetstone.md`, rule 6, holds the complete and only list of
skills Ben may claim. **Read that file before typing a single skill into any resume, application
form, agency profile, or LinkedIn field.** Do not write a skill from memory, from the posting's
keyword list, or because it seems adjacent to something he does.

**Approved:** SQL · T-SQL · Microsoft Power BI · Microsoft Excel (advanced, pivot tables,
Power Query) · Data Analysis · Data Visualization · DP-900 · Google Ads · CRM administration and
reporting (Lofty, SkySlope) · relational data modeling · data quality QA

**Not approved — never list:** GA4 / Google Analytics (Ben doesn't use it; Google *Ads* is real,
Google *Analytics* is not — different products) · Google Tag Manager · anything absent from rule 6.
**Tableau** only as "Tableau Desktop Specialist (in progress)"; **Python** only as
"Python (pandas, in progress)" — never as bare tags.

On ATS pickers that take bare terms with no room for a qualifier, list only the approved bare
skills and omit Python and Tableau entirely. A bare tag reads as working proficiency.

> Why this rule exists: on the Merative application, bare "Tableau," "Python," and "Google
> Analytics" tags were entered from memory. Ben doesn't have those skills and didn't know what GA4
> was. Rule 6 had said so since July 13 — it just wasn't read. Overstating a skill is worse than
> omitting one: it survives the ATS and dies in the interview.

If a required fact is missing, ask Ben — or better, tell him to run the `career-counselor` skill first so the profile is complete.

---

## Step 2 — Read the posting and extract its language

Before writing anything, mine the job description (tweaks #1 and #6 from Ben's playbook):

1. Pull the **exact noun phrases** for tools, methods, and responsibilities ("Microsoft Power BI", "self-service dashboards", "campaign performance", "SQL Server", "A/B testing"). Use them verbatim later — synonyms lose ATS points.
2. List the **required** vs **preferred** qualifications.
3. Note the **domain** (marketing/CRM, sports, finance, healthcare, etc.) — Ben's edge is his 10 years of marketing/CRM/revenue analytics, so lean into it when the domain allows.
4. Capture any **screening questions** and salary field.
5. **Sanity-check the employer before spending effort.** A company with a near-empty profile, a handful
   of flawless 5.0 reviews, a generic name, or the same role posted elsewhere at a different salary band
   is often a resume-harvesting listing. Flag it once, plainly, and let Ben decide — then move on.

Target **~70% keyword overlap** with the posting in the finished resume — placed in achievement context, never a hidden keyword dump (2026 AI screeners flag stuffing).

---

## Step 3 — Build the resume

**Section order (career-changer optimized):**
1. Name + contact block (with portfolio link)
2. **Professional Summary** — a tight 3-line pitch, re-pointed to this exact role (tweak #4)
3. **Skills** — grouped, tool-exact, depth over breadth (a laundry list of 5+ languages is a red flag; only list what he can be interviewed on)
4. **Projects / Portfolio** — cite `data.benwhetstone.info`: Closing Day (production SaaS data model + QA), the AI-ops layer, and the analytics artifacts. Each as one quantified line + the link.
5. **Work Experience** — quantified, JD-mirrored bullets
6. **Education & Certifications** — MPA (Troy), USF Graduate Certificate, B.S. (UoP), DP-900, in-progress PL-300/Tableau

**Bullet formula — duties → wins (this is the single biggest lever):**
> Action verb + what you analyzed + tools + quantified outcome (%, $, time, volume)

Strong action verbs: Analyzed, Built, Cleaned, Modeled, Visualized, Automated, Reconciled, Presented, Reallocated, Investigated.

Good vs. bad (the standard to hit):
- ❌ "Own marketing analytics; assess ROI and reallocate budget."
- ✅ "Built Power BI dashboards tracking campaign ROI across Google Ads, GA4, CRM, and direct mail; reallocated ~$X of annual spend and lifted marketing ROI ~Y%."
- ❌ "Perform data QA."
- ✅ "Ran daily SQL data-collection QA on a live SaaS platform, tracing anomalies to root cause across N sources and cutting data-error tickets ~Z%."

Aim for **3–4 measurable bullets per current role.** If a real number is unknown, pull it from the Career Intake Profile or ask Ben — do not fabricate. It's fine to use honest ranges/approximations he confirms.

**Mechanics (ATS-safe):** single column, no tables/text-boxes/columns/graphics/photos, web-safe font, ATS-standard headings, reverse-chronological, one page, **text-based PDF only** (never image-based).

---

## Step 4 — Build the cover letter

- 250–400 words, one page. Letterhead matching the resume (centered name + contact line with a rule), date, recipient block, bold `Re:` line, named greeting (never "To Whom It May Concern").
- Structure: **hook** (name the exact work + fit/location advantage) → **one metric-dense evidence paragraph** ($30M+ marketing analytics, a concrete ROI/number) → **technical-proof paragraph** (SQL, Power BI, Excel, DP-900, "proof at data.benwhetstone.info") → **close** (why this employer + clear ask).
- **70/30 authenticity rule:** the structure can be templated, but the final pass must add one **specific micro-anecdote and numbers only Ben would know** — 74–80% of hiring managers reject letters that read as AI. Apply the read-aloud test: it should sound like Ben.

---

## Step 5 — Generate the files

Produce **text-based PDFs** (ATS requirement). Use the `docx`-then-PDF pipeline that already works in this environment:

1. Write a small Node script using the `docx` library (see the existing `*_resume.js` / `*_cover.js` generators in the outputs folder as templates — reuse the helper functions: `sectionHeading`, `jobTitle`, `jobSub`, `bullet`, `body`).
2. `node <name>_resume.js && node <name>_cover.js`
3. Convert to PDF with LibreOffice in the Linux sandbox: `soffice --headless --convert-to pdf "<file>.docx"`.
4. Name files: `<Company> - <Role> - Resume - Whetstone.pdf` and `... - Cover Letter - Whetstone.pdf`.
5. Resumes go in `/Job Search/Resumes/`, cover letters in `/Job Search/Cover Letters/`. Once submitted,
   move both into the matching `Archive - Submitted/` subfolder.

**Organizing means moving, never deleting.** Ben has explicitly said "I didn't ask you to delete, I asked
you to organize properly." If two files collide on name, rename one with a `DUP - ` prefix and flag it —
don't resolve the conflict by removing a file. He can delete; you sort.

---

## Step 6 — Drive the online application

Use the browser (Claude-in-Chrome) to complete the application:

1. Navigate to the posting's apply URL. If multiple Chrome browsers are connected, have Ben pick one first.
2. **Prefer "Apply Manually" over "Autofill with Resume"** when the ATS offers both.
3. Upload the tailored **resume PDF** into the resume slot (verify it's the resume, not the cover letter — a classic mistake).
4. **The moment an upload finishes, read back every auto-parsed field and fix it before scrolling on.**
   Workday and UltiPro parsers rewrite employment dates, addresses, and names without announcing it, and
   once you've scrolled past, you won't catch it.
   > Meduit's parser silently changed Ben's employment dates *and* his home address. It was caught only
   > because he happened to be watching the screen. Assume the parser got something wrong and go look.
5. Fill profile, work history, and education from Ben's facts.
6. Answer screening questions from the Career Intake Profile / Ben's facts. For salary, use his target from the profile; **numbers only** if the field validates as numeric (strip `$`/commas).
7. Voluntary self-ID: Male / White (non-Hispanic) / **Protected Veteran: Yes** / **Disability: Yes**, unless Ben says otherwise.
8. **Stop at the final review/submit screen and get Ben's explicit go before clicking Submit.** Submitting is irreversible. Show him the salary and any judgment-call answers first.

### Step 6b — Form mechanics that actually work

These are hard-won; ignoring them produces forms that look filled but aren't.

- **Use `form_input` with a ref.** Setting values through raw JS doesn't trigger React's state update, so
  the field looks populated on screen while the framework still considers it empty — paired required
  textareas then fail validation with no visible cause.
- **Hidden file inputs aren't in the accessibility tree.** `read_page` returns the visible "Choose File"
  *button*, which is not the input. Use the `find` tool to locate the real `type="file"` element.
- **On macOS use `cmd+a` to clear a field, never `ctrl+a`** — `ctrl+a` jumps to line start and you end up
  prepending text to the existing value ("B07172026en Whetstone").
- **Page re-renders shift coordinates mid-batch.** Re-read the page instead of reusing coordinates from
  an earlier screenshot, or values land in the wrong fields.
- **Never close a tab holding a filled, unsubmitted form.** There's no recovery; the whole fill is lost.
- **Batch actions with `browser_batch`.** Screenshotting between every step is the main reason this
  workflow feels slow to Ben.

### Step 6c — Fill EVERY field, then sweep for blanks before submit (never skip)

Skipped fields are the single biggest defect in this workflow. A half-filled application reads as
careless and can auto-reject before a human ever sees it. Two non-negotiable rules:

- **Fill everything that accepts content.** Work-history **description / responsibilities** boxes,
  profile summary fields, "additional information," and every required dropdown get populated from
  Ben's canonical data. Work-history descriptions come from `resume-builder`'s `voice.md` bullets
  (reworded only to fit a plain-text box — never left blank). An empty description box is a defect,
  not a shortcut. Optional fields that take relevant content get filled, not skipped.
- **Sweep before you submit.** Before asking Ben for the go-ahead, **re-read every page top to
  bottom** (do not trust memory — Workday/UltiPro re-renders and parsers hide field state) and
  confirm no input, textarea, or required select that should have content was left empty. List any
  blanks you find, fill them, then proceed. If a field genuinely has no honest answer, say so out
  loud rather than leaving it silently empty. Do not advance to the Submit screen with known blanks.

---

## Step 7 — Update the tracker immediately after submitting

Do this before the next application and before reporting back — a status recorded "later" is a status
that gets recorded wrong.

1. Set `status` to `submitted` with the date in `/Job Search/Tracking/job-search.json`.
   **Don't write "Submitted" in the notes** — the status field already says that. Notes are for what's
   unusual: receipt date, corrections made, employer quirks.
2. Regenerate the `DATA` array in `job-search-dashboard.html` from the JSON.
3. Copy both files to `/Job Search/Tracking/`.
4. POST the JSON:
   ```
   curl -s -X POST https://roadmap.benwhetstone.info/api/job-search \
     -H "Authorization: Bearer $ROADMAP_TOKEN" \
     -H "content-type: application/json" --data @job-search.json
   ```
5. Update the Cowork artifact `job-search-dashboard` via `update_artifact`.
6. Archive the resume and cover letter into `Archive - Submitted/`.

An application isn't done until the JSON, the dashboard, and the API all say the same thing.

---

## Working mode — keep going

Ben's standing instruction is to keep working. Finishing one item is not a stopping point; it is a
cue to start the next one.

**After completing any task:** update the tracker, then immediately begin the next open item on the
task list. Do not stop to report and wait. Do not close with "want me to do X next?" or "unless you'd
rather..." — the task list already answers what's next, so consult it and go. Ben has said this
repeatedly: *"stop stopping"*, *"why did you stop working"*, *"why do you keep stopping after you
complete something"*, *"never ask trailing questions, it is so annoying."*

**Report as you go, not as a request for permission.** One or two sentences on what landed, then the
next tool call. Save the summary for when the list is genuinely empty or Ben redirects.

**Only stop for:**
- an irreversible Submit that needs Ben's go-ahead
- a credential or CAPTCHA only Ben can supply
- a genuine fork where the wrong choice wastes real work and the answer isn't in his files
- a discovered error worth flagging before it propagates

Everything else: decide, act, tell him what you decided.

**Re-read this SKILL.md often — not just at the start.** Consult it again before each new application,
whenever a task changes shape, and any time you're about to type Ben's personal facts or skills into a
form. Most failures in this workflow came from working out of memory after the skill had scrolled out
of working attention. Re-reading costs seconds; a wrong claim on a submitted application can't be
taken back.

---

## Guardrails
- Never fabricate metrics, tools, titles, dates, or clearances. Everything must survive an interview.
- Keep resume to one page and PDF text-based.
- One application at a time, done well (tweak #5: fewer, targeted, high-effort apps beat volume).
- Always pause before the irreversible Submit.
- **Don't ask Ben questions the resume, tracker, or posting already answers.** He's said "stop creating
  work for me with dumb questions" and "stop making me think for you." Make the call and proceed; tell
  him what you decided.
- **Report failures plainly and immediately.** Never print a success message for an operation that didn't
  verifiably succeed — check the actual result, not the exit status of an echo. If a file operation in a
  mounted Drive folder returns "Operation not permitted," say so rather than reporting it as done.
