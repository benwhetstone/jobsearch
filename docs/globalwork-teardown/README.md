# GlobalWork.ai — full teardown
Captured 2026-07-28 from a live authenticated account (Ben Whetstone), plus static analysis
of the production JS bundle.

## Read this first
`PROJECT-BRIEF-for-claude-code.md`  <- paste this whole file into Claude Code

## Contents

    PROJECT-BRIEF-for-claude-code.md   the deliverable: architecture + schema + build order
    notes/01-api-endpoints.md          all 50 REST endpoints, grouped by domain
    notes/02-dcp-schema.md             the full 92-field profile schema with every enum
    notes/03-entities-and-flows.md     entity shapes, state machines, stack, business model
    code/api-contracts.ts              TypeScript contracts reconstructed from live responses
    notes/04-CORRECTIONS-and-scoring-formula.md   corrections after adversarial verification + solved formula
    code/match-score-bands.ts          their copy table, deminified + the SOLVED scoring formula
    screenshots/                       13 screens

## Screens

    01-jobs-list                       120 ranked recommendations with % match
    02-applications-pipeline           actionRequired / readyToApply / applying / applied
    03-analytics                       funnel vs market avg, 30-day streak grid, salary alignment
    04-application-detail-apply-form   the ATS form mirror, prefilled, held for approval
    05-resume-tab-redline-diff         tailored resume as tracked changes vs base
    06-cover-letter-tab                generated cover letter with AI phrases highlighted
    07-match-score-breakdown           per-ranker scores with plain-English explanations
    08-inbox                           All / Updates / Rejections / Interviews / Offers
    09-resumes-list                    CV library
    10-candidate-profile-blocks        6 DCP blocks with filled/total counts
    11-profile-block-editor            schema-driven form: question text as label, category as tab
    12-settings-subscription           plan management
    13-job-detail-prepare-application  job view with match score and the Prepare Application CTA

## The four ideas worth stealing

1. DCP - a server-defined profile schema where every field carries the plain-English
   question it answers, so one row drives the profile UI, the match score, and the
   ATS answer lookup.
2. Two-stage retrieve-then-rank with five explainable 0..1 rankers, each returning
   missingData[] naming the profile field that blocked a confident score.
3. ATS form mirror - scrape the employer's form, re-render it natively, prefill with AI,
   never guess on a required field, hold for human approval.
4. The redline diff - show the tailored resume as tracked changes against the base, so the
   human sees every word the AI changed before submitting.

## The one architectural trick

They issue every user a managed relay inbox on their own domain (envelopad.com) and submit
every application from it. No Gmail OAuth, no IMAP, no token refresh - and they see every
recruiter reply, which is where the entire analytics feature comes from.

## Verification

The first draft went through an 8-agent adversarial verification pass. Four claims were
refuted and are corrected in notes/04. Chasing one of them produced their exact scoring
formula, fitted to 16 live samples:

    totalScore = (0.55*skills + 0.45*experience) * (0.91 + 0.09*compensation)

Two findings from that: relevanceScore contributes nothing to totalScore, and compensation
is only a 9% gate, so a job with completely wrong pay still shows an 82% match.

The other correction worth knowing: their AI prefilled 10 of 18 fields on a real
application. All 10 were free text. All 8 failures were `select` fields. Their generator
writes prose well and cannot map a value onto an employer's option list.
