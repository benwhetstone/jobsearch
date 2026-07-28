# Corrections after adversarial verification + the solved scoring formula
Produced after an 8-agent adversarial verification pass over the first draft.
Everything below was re-checked against the LIVE authenticated API.

## 1. THE SCORING FORMULA IS SOLVED

Fitted against 16 real jobs from POST /api/v1/jobs/recommended/v2 (120 total returned).
Mean absolute error < 0.0002. This is not an inference; it is a fit to observed data.

    core       = 0.55 * skills + 0.45 * experience
    totalScore = core * (0.91 + 0.09 * compensation)

Evidence (total | 0.55*sk+0.45*ex | compensation | delta):

    0.9887   0.9887   1.0000   -0.0000
    0.9586   0.9586   1.0000   +0.0000
    0.8699   0.8699   1.0000   +0.0000
    0.8683   0.8683   1.0000   +0.0000
    0.8551   0.8551   1.0000   +0.0000
    0.8448   0.8448   1.0000   +0.0000
    0.4185   0.4185   1.0000   -0.0000
    0.4125   0.4125   1.0000   +0.0000
    0.4050   0.4051   1.0000   -0.0001
    0.4005   0.4005   1.0000   +0.0000

When compensation != 1 the 0.09 gate resolves the residual exactly:

    total   pred     base     comp
    0.8157  0.8157   0.8964   0.0000
    0.7332  0.7332   0.7559   0.6667
    0.6550  0.6550   0.7198   0.0000
    0.5844  0.5844   0.6422   0.0000
    0.5769  0.5769   0.6340   0.0000
    0.5611  0.5611   0.5784   0.6667

### Consequences

1. relevanceScore contributes NOTHING to totalScore (fitted weight -0.00).
   It is a separate diagnostic. The earlier annotation "relevanceScore = skills+experience only"
   is REFUTED: relevanceScore is always BELOW both skills and experience
   (e.g. sk 0.985, ex 0.9933, rel 0.8166), which no weighted average can produce.

2. compensation is only a 9% multiplicative gate. A total pay mismatch (score 0)
   costs a job just 9% of its match score. One observed job scores 0.8157 (82% match)
   with compensation = 0.

3. terms and company are 1.0 on all 120 jobs, so their weights are unidentifiable
   from this data. Assume the same (0.91 + 0.09*x) gate shape.

4. Scale: rankerScores and totalScore are 0..1 in the API. The client's band table
   (code/match-score-bands.ts) resolves on 0..100. A x100 conversion happens client-side.
   VERIFIED against the UI: totalScore 0.9586 -> card reads "96% match";
   0.8699 -> "87%"; 0.8683 -> "87%".

5. Reranking genuinely reorders. Observed (retrievalMeta.index -> rankMeta.index, 0-based):
   0->0, 5->1, 25->2, 4->3. A job 26th on retrieval finished 3rd after ranking.

## 2. AI PREFILL IS PARTIAL, AND THE FAILURE MODE IS SPECIFIC

GET /auto-apply/applications/16f2b9eb.../details, 18 fields:

    type            count   prefilled
    text              7        7
    textarea          2        2
    checkboxGroup     1        1
    select            8        0        <-- ALL EIGHT EMPTY

    totalFields 18 | prefilled 10 | empty 8 | emptyAndRequired 8

Every prefilled field is free text. Every failure is a `select`, i.e. a question whose
answer must map onto an employer-supplied option list. The "8" badge on the Apply form tab
is the unfilled-required count, and it is why the application sits in actionRequired.

The earlier draft claimed the city autocomplete was "already resolved". It was NOT:
Location (City) rendered "Select..." with "Field is required". Corrected.

This is the single clearest weakness in their product and the highest-value thing to beat:
enum-to-option coercion is a lookup problem, not a generation problem.

## 3. TAILORED CVs CONFIRMED

GET /api/v1/cv returns 28 records:
    type values observed: ["TAILORED", "DEFAULT"]
    27 with a non-null jobUuid, 1 with null jobUuid and isDefault = true
    all status COMPLETED

So the versioned-document model is CONFIRMED, not inferred. 'TAILORED' is the literal value.
The Resumes screen shows only the default, which is why this was not visible in the UI walk.

BUT: there is no parentUuid / parent_uuid field on the CV entity. Keys are exactly:
uuid, title, userUuid, isDefault, personalDetails, professionalSummary, employmentHistory,
socialLinks, educationHistory, professionalTitle, skills, courses, internship, hobbies,
languages, extraActivities, customSections, reference, jobUuid, status, sharedHash,
sharedViews, type, updatedAt, template, color.

The diff must therefore be computed against the isDefault=true row.
`parent_uuid` in the project brief's schema is OUR addition, not theirs.

## 4. isMatchingParam DOES NOT MEAN "FEEDS THE MATCH SCORE"

Verified live across all 6 blocks:
    total fields         92
    isMatchingParam true 34   (not ~30)
    per block: personalDetails 5, workEligibility 5, workPreferences 7,
               professionalProfile 8, company 0, career 9

The 5 flagged in personalDetails are: email, firstName, lastName, linkedinProfile, phone.
A surname cannot feed a match score. And the `company` block has ZERO matching params
despite a `company` ranker existing in rankerScores.

CONCLUSION: the flag marks required/core profile fields, not match inputs.
The earlier draft's reading was wrong. Treat the name as misleading.

## 5. question IS NULLABLE

7 of 92 fields have question = null:
    driverExperience, nationality (personalDetails)
    ratePerHour, variableSalaryIsPercentage (workPreferences)
    internalSeniorityScore (professionalProfile)
    companyMaturityExperience (company)
    desperateScore (career)

The earlier claim that "question: null means system-derived, never shown" is WRONG:
nationality and ratePerHour are plainly user-supplied. Only internalSeniorityScore and
desperateScore look computed, and that remains an inference.

## 6. TAXONOMY COUNTS ARE LIVE, BUT THE LIGHTCAST ATTRIBUTION IS INFERENCE

Counts come from meta.totalRecords on the taxonomy endpoints and MOVED during the session:
    skills     344,106 -> 344,293
    titles      23,996 -> 24,012
    industries     700 -> 700
Drift confirms these are live reads, not estimates.

However 344k is roughly 10x the public Lightcast Open Skills library (~33k).
The `lightcastId` field EXISTS on the record shape (verified) and is EMPTY on
user-created entries. "Seeded from Lightcast" is therefore INFERENCE, and the table
is clearly much larger than Lightcast alone.

## 7. OTHER FIXES

- API base host: the gateway is https://rjf-gateway-prod.globalwork.ai/api/v1.
  notes/01 previously said https://globalwork.ai/api/v1. The gateway is correct;
  globalwork.ai/api/v1 returns 404 for these paths.
- The 13-value ATS field type union (text|textarea|number|date|file|select|autocomplete|
  radio|radioGroup|checkbox|checkboxGroup|dialog|skills) comes from CLIENT BUNDLE FIXTURES,
  not from an observed API response. Only text, textarea, select and checkboxGroup have
  been seen in a live /details payload.
- The write path (PATCH .../job-forms, POST .../approve) is bundle-derived. It was never
  exercised: no application was submitted during this teardown.
- "every enum" was over-claimed. Roughly a dozen DCP enums were captured only as counts
  (country 249, gender 4, raceEthnicity 7, sexualOrientation 6, veteranStatus 4,
  legalSetup 20, workAuthorization 24, relocationArea 11, searchMotivation 11,
  searchTrigger 6, workStatus 4). The values for those are partial.
- The DCP field object has TEN keys, not nine. categoryUuid was omitted from the
  first draft's field list and storageTarget from its DDL.
- storageTarget was observed with exactly one value (FIELD_VALUE) across all 92 fields.
