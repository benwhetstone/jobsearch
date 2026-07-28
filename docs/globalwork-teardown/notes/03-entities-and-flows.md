# GlobalWork.ai — entities, states, and flows (observed live)

## Hosts
App:        https://globalwork.ai/v2/            (React + Vite SPA, single bundle)
API:        https://rjf-gateway-prod.globalwork.ai/api/v1/
Legacy tel: capig.remotejobsfinder.co            (server-side conversion API)
Mail relay: *@envelopad.com                      (managed candidate inbox)
Internal codename: RJF = Remote Jobs Finder (localStorage key rjf:onboarding-process:v4)

## Client stack (confirmed by bundle probes)
React (SPA, #root), Vite, react-router (v6 object routes)
MUI + emotion, TanStack Query, Zustand + redux-persist, react-hook-form, Zod + Yup, axios
Amplitude analytics, GrowthBook feature flags (gbFeaturesCache / gbStickyBuckets in localStorage)
Auth: JWT accessToken + refreshToken in localStorage, Bearer header, isAuth flag
No SSR, no i18n, no Sentry, no websockets, no Stripe.js (SolidGate hosted checkout)

## Routes
/v2/jobs
/v2/applications                     (?summaryKey=<state>&__applicationId=<uuid>)
/v2/inbox        /v2/inbox/:threadId
/v2/analytics
/v2/resumes      /v2/resumes/:resumeId/edit
/v2/profile      /v2/profile/block/:blockName
/v2/settings  /v2/onboarding  /v2/login  /v2/choose-plan  /v2/limited-offer  /v2/limited-offer-2

## JOB entity  (POST /api/v1/jobs/recommended/v2  body {filters:{hasModernAutoApply:true}})
uuid, title, companyName, companyUuid, companyUrl, jobUrl, applyUrl, logoUrl
level, type, board, status(ACTIVE), createdAt, timePosted, hasExpired
commitments[]
employment { engagementType[], timeCommitment[], duration, isInternship, isVolunteer }
seniority { trackClassification: individual_contributor|..., yearsRequired, individualContributorType: entry|junior|middle|senior }
yearExperience, education, skills[]
compensation {
  baseSalary { min, max, currency, period, type }
  oteSalary
  variableCompensation { exists, components[{ type, valueType, amount, percentage, frequency, discretionary }] }
}
rateHourlyMin, rateHourlyMax, rateUnit
locations[{ country, state, city, continentRegion }]
allowAutoApply, isFavorite, isViewed, isApplied, isPrimary
scamScore (0..2 observed), duplicateUuids[], contactEmail
descriptionHtml, description
retrievalMeta { score (unbounded, e.g. 4.93), index }
rankMeta {
  relevanceScore, totalScore, index,
  rankerScores { skills, experience, compensation, terms, company }  each { score 0..1, missingData[] }
}
--- response meta: { skip, limit, totalRecords, recommendationRequestId }

TWO-STAGE PIPELINE: retrieval (BM25/vector, own ordering) -> rerank (5 weighted rankers -> totalScore)
totalScore is the "% match" on the card. UI shows 4 of 5 rankers (company is hidden).
Each ranker returns missingData[] naming the profile fields that blocked a confident score.

## APPLICATION entity  (GET /api/v1/auto-apply/applications)
applicationUuid, jobUuid, atsUuid, supportedAts, publicStatus,
submittedAt, parsedAt, matchedAt,
invalidFields[{ status, validationStatus, validationMessage, label }],
missingDetails[ string ],
job { ...full job entity... , cv{uuid,title,status}, coverLetter{uuid,title,status}, autoApplyStatus }

publicStatus values:  preparing | readyToApply | applying | applied | actionRequired | failed | expired
summary endpoint returns counts for all seven.

## APPLICATION DETAIL  (GET /api/v1/auto-apply/applications/{uuid}/details)
{ applicationUuid, jobUuid, publicStatus, needManualApply, done, submittedAt,
  cv{uuid,title,status}, coverLetter{uuid,title,status}, job{...},
  sections: [ { section: "other",
                fields: [ { uuid, type, label, value, options[], required, placeholder, order } ] } ] }

FIELD TYPE UNION (from bundle fixtures):
  text | textarea | number | date | file | select | autocomplete |
  radio | radioGroup | checkbox | checkboxGroup | dialog | skills

This is a faithful re-render of the employer's ATS form: verbatim labels, scraped options,
required flags, original order. `value` is pre-filled by AI.

WRITE PATH:
  PATCH /api/v1/auto-apply/applications/{uuid}/job-forms   body { fields: [{ jobFieldUuid, value }] }
  POST  /api/v1/auto-apply/applications/{uuid}/approve     -> optimistic publicStatus = "applying"

SUPPORTED ATS (observed in live data): greenhouse, workable, workday, zoho, applytojob (JazzHR)
Unsupported -> needManualApply = true, card renders "Manual apply" instead of "Prepare application"

## CV entity  (GET /api/v1/cv/default, /api/v1/cv/{uuid})
uuid, title, userUuid, isDefault, jobUuid, type(DEFAULT|tailored), status(COMPLETED|PROCESSING|PENDING|FAILED)
personalDetails{ firstName,lastName,email,phoneNumber,country,city,address,postalCode,citizenship }
professionalTitle, professionalSummary
employmentHistory[{ title, employer, startDate, endDate, city, description }]
educationHistory[{ title, school, degree, startDate, endDate, description, city }]
skills{ isHidden, data[{uuid,title,level}], suggested[] }
socialLinks, courses, internship, hobbies, languages, extraActivities, customSections[], reference
template (TEMPLATE_2), color (PURPLE)
sharedHash, sharedViews          <- public share link + view counter
updatedAt

A CV is a VERSIONED DOCUMENT KEYED TO jobUuid. Base = type DEFAULT, jobUuid null.
Each tailored variant is a new row -> both documents always exist -> redline diff is possible.

AI endpoints: /cv/phrases/ai, /cv/text/ai, /cv/{uuid}/professional-summary/ai
Ingest:       POST /cv/process/v2  -> poll GET /cv/{uuid}/processing (status PENDING/PROCESSING/COMPLETED/FAILED)
Export:       GET  /cv/{uuid}/download-pdf

## EMAIL ACCOUNT  (GET /api/v1/email/accounts)
{ uuid, provider: "managed", address: "<handle>@envelopad.com", status: "active",
  priority: 1, blockedAts: [], createdAt, updatedAt }

They ISSUE a relay address and submit every application from it. No Gmail OAuth, no IMAP.
Inbox buckets: All | Updates | Rejections | Interviews | Offers  (classifier over inbound mail)
Threaded view + inline Reply (POST /email/messages/{id}/reply), read receipts, unread summary.

## TAXONOMY  (GET /api/v1/taxonomy/{skills|titles|industries}?search=)
skills:     344,106 records   { uuid, lightcastId, name, level }   <- LIGHTCAST Open Skills ontology
titles:      23,996 records   { uuid, name, level }                <- free-entry, visibly dirty ("?", "???")
industries:     700 records   { uuid, name, ... }                  e.g. "Financial Services", "Government & Defense"
Asymmetry is deliberate: skills are ontology-anchored, titles are user-generated with dedupe.

## ANALYTICS
GET /auto-apply/application-funnel:
  [{stage:"applied",count,conversion:null,marketAvg:null},
   {stage:"replies",count,conversion:20.8,marketAvg:3.5},
   {stage:"interviews",count,conversion:0,marketAvg:45},
   {stage:"offers",count,conversion:0,marketAvg:26}]
GET /auto-apply/activity-tracker:  30-day grid, buckets 0 / 1-5 / >5, current streak, most active day
GET /auto-apply/quota/monthly-applications:  { remaining: 75, total: 100 }
GET /salary-stats/chart:  "Salary Alignment" — your expectations vs current market offers

## USER PROFILE  (GET /api/v1/user-profile)
uuid, email, productId, createdAt
userInfo{ experience, level, education, commitment[], country, state, city, jobType[], rateType,
          rateHourlyFrom, rateHourlyTo, english, availability, jobApplicationType, jobSchedule,
          teamSetup, companySize[], priority, fullName, categories[] }
userSettings{ trackUuid, userControlGroup, dashboardControlGroup, dashboardResumeUploadControlGroup,
              jobCardJobDetailsControlGroup, userSubControlGroup, platformVersion }   <- 5 A/B slots
subscription{ uuid, isActive, isTrial, name, status, subscriptionPrice, productPrice, currency,
              nextChargeDate, addons[], paymentProvider: "SOLIDGATE", discount{isActive,percentage},
              canRestore, source }
userProfilePlugin{ userUuid, isInstalled, isLoggedIn, firstName, lastName, country, email,
                   phoneNumber, socialLinks[], salaryExpectations, workAuthorization,
                   visaSponsorship, gender, race, veteranStatus, disabilityStatus, cvUuid }
   ^ browser-extension fallback: denormalized copy of exactly the fields ATS forms ask for

## BUSINESS MODEL
$24.99/mo billed, $49.99 list, permanent 50% discount, SolidGate (not Stripe).
100 auto-applications / month.
Growth stack on the authenticated app: Snapchat, TikTok, LinkedIn Insight, MS Clarity,
Reddit, Google Ads, Bing UET, Cookiebot, Fillout, Amplitude, GrowthBook.
