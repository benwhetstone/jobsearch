// GlobalWork.ai API contracts, reconstructed from live authenticated responses.
// Base: https://rjf-gateway-prod.globalwork.ai/api/v1
// Auth: Authorization: Bearer <accessToken>   (JWT in localStorage, refreshed via /auth/refresh)

// ---------------------------------------------------------------- DCP
export type DcpFieldType =
  | 'string' | 'number' | 'boolean' | 'string_array' | 'object_array';

export interface DcpField {
  fieldKey: string;
  fieldType: DcpFieldType;
  question: string | null;      // human-readable; drives BOTH the profile UI and ATS answer lookup
  categoryUuid: string;
  categoryKey: string;          // UI tab grouping inside the block
  options: string[];            // controlled enum, [] for free text
  isMultiSelect: boolean;
  isMatchingParam: boolean;     // true -> feeds the job match rankers
  storageTarget: 'FIELD_VALUE' | string;
  order: number;
}

export type DcpBlockName =
  | 'personalDetails' | 'workEligibility' | 'workPreferences'
  | 'professionalProfile' | 'company' | 'career';

// GET /user/dcp/blocks/{blockName}/fields
export interface DcpBlockResponse { key: DcpBlockName; fields: DcpField[]; }

// GET /user/dcp/completion
export interface DcpCompletion {
  score: number;                                    // 0-100 profile strength
  title: { uuid: string; name: string; level: number };
  blocks: Record<DcpBlockName, { filledCount: number; totalCount: number }>;
}

// ---------------------------------------------------------------- JOBS
export interface RankerScore { score: number; missingData: string[]; }

export interface Job {
  uuid: string;
  title: string;
  companyName: string;
  companyUuid: string;
  companyUrl?: string;
  jobUrl: string;
  applyUrl?: string;
  logoUrl: string | null;
  level: string;
  type: string;
  board?: 'greenhouse' | 'workable' | 'workday' | 'zoho' | 'applytojob' | string;
  status?: 'ACTIVE' | string;
  createdAt: string;
  timePosted?: string;
  hasExpired?: boolean;
  commitments: string[];
  employment: {
    engagementType: string[];
    timeCommitment: string[];
    duration: string | null;
    isInternship: boolean;
    isVolunteer: boolean;
  };
  seniority?: {
    trackClassification: 'individual_contributor' | string;
    yearsRequired: number;
    individualContributorType: 'entry' | 'junior' | 'middle' | 'senior' | string;
  };
  yearExperience?: number;
  education?: string;
  skills?: string[];
  compensation: {
    baseSalary: { min: number; max: number; currency: string; period: string; type: string | null } | null;
    oteSalary: unknown | null;
    variableCompensation: {
      exists: boolean;
      components: Array<{
        type: string; valueType: string; amount: number | null;
        percentage: number | null; frequency: string; discretionary: boolean;
      }>;
    };
  };
  rateHourlyMin: number; rateHourlyMax: number; rateUnit?: string;
  locations: Array<{ country: string; state: string | null; city: string | null; continentRegion: string | null }>;
  allowAutoApply: boolean;
  isFavorite: boolean; isViewed: boolean; isApplied: boolean; isPrimary?: boolean;
  scamScore?: number;            // 0..2 observed - fraud heuristic on the posting
  duplicateUuids?: string[];     // cross-board dedup cluster
  contactEmail?: string | null;
  description?: string;
  descriptionHtml?: string;

  // two-stage recommendation telemetry, returned to the client
  retrievalMeta: { score: number; index: number };        // stage 1: unbounded similarity
  rankMeta: {                                             // stage 2: feature rerank
    // CORRECTED after fitting 16 live samples:
    //   totalScore = (0.55*skills + 0.45*experience) * (0.91 + 0.09*compensation)
    //   fitted error < 0.0002; relevanceScore's fitted weight is -0.00, i.e. it is NOT an input.
    //   terms and company are 1.0 on all 120 observed jobs, so their weights are unidentifiable.
    relevanceScore: number;   // 0..1  opaque stage-1 signal. NOT a blend of skills+experience:
                              //       it sits BELOW both on every sample (sk .985, ex .9933, rel .8166)
    totalScore: number;       // 0..1  x100 client-side -> the "% match" on the card (verified)
    index: number;
    rankerScores: {
      skills: RankerScore; experience: RankerScore;
      compensation: RankerScore; terms: RankerScore; company: RankerScore;
    };
  };
}

// POST /jobs/recommended/v2   body: { filters: { hasModernAutoApply: true } }
export interface JobRecommendationsResponse {
  data: Job[];
  meta: { skip: number; limit: number; totalRecords: number; recommendationRequestId: string };
}

// ---------------------------------------------------------------- APPLICATIONS
export type PublicStatus =
  | 'preparing' | 'readyToApply' | 'applying' | 'applied'
  | 'actionRequired' | 'failed' | 'expired';

export interface Application {
  applicationUuid: string;
  jobUuid: string;
  atsUuid: string;
  supportedAts: boolean;
  publicStatus: PublicStatus;
  submittedAt: string | null;
  parsedAt: string | null;
  matchedAt: string | null;
  invalidFields: Array<{
    status: 'skipped' | string;
    validationStatus: string | null;
    validationMessage: string | null;
    label: string;                 // verbatim employer question that could not be answered
  }>;
  missingDetails: string[];
  job: Job & {
    cv: { uuid: string; title: string; status: string };
    coverLetter: { uuid: string; title: string; status: string };
    autoApplyStatus: string | null;
  };
}

// GET /auto-apply/applications/summary
export interface ApplicationSummary {
  actionRequired: number; readyToApply: number; applying: number;
  preparing: number; applied: number; expired: number; failed: number;
}

// ---------------------------------------------------------------- ATS FORM MIRROR
export type AtsFieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'file'
  | 'select' | 'autocomplete'
  | 'radio' | 'radioGroup'
  | 'checkbox' | 'checkboxGroup'
  | 'dialog' | 'skills';

export interface AtsField {
  uuid: string;
  type: AtsFieldType;
  label: string;          // employer's verbatim question text
  value: string | null;   // AI-prefilled answer
  options: string[];      // scraped from the source form
  required: boolean;
  placeholder: string;
  order: number;
}

// GET /auto-apply/applications/{uuid}/details
export interface ApplicationDetails {
  applicationUuid: string; jobUuid: string;
  publicStatus: PublicStatus;
  needManualApply: boolean;
  done: boolean;
  submittedAt: string | null;
  cv: { uuid: string; title: string; status: string };
  coverLetter: { uuid: string; title: string; status: string };
  job: Job;
  sections: Array<{ section: string; fields: AtsField[] }>;
}

// PATCH /auto-apply/applications/{uuid}/job-forms
export interface PatchJobFormsBody { fields: Array<{ jobFieldUuid: string; value: string }>; }
// POST  /auto-apply/applications/{uuid}/approve   -> optimistic publicStatus = 'applying'
// Client polls /details on an interval while publicStatus is 'preparing' | 'applying'.

// ---------------------------------------------------------------- CV
export interface Cv {
  uuid: string; title: string; userUuid: string;
  isDefault: boolean;
  jobUuid: string | null;              // null on the base CV; set on every tailored variant
  type: 'DEFAULT' | string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  personalDetails: {
    firstName: string; lastName: string; email: string; phoneNumber: string;
    country: string; city: string; address: string; postalCode: string; citizenship: string;
  };
  professionalTitle: string;
  professionalSummary: string;
  employmentHistory: Array<{ title: string; employer: string; startDate: string; endDate: string | null; city: string | null; description: string }>;
  educationHistory: Array<{ title: string; school: string; degree: string; startDate: string | null; endDate: string; description: string | null; city: string | null }>;
  skills: { isHidden: boolean; data: Array<{ uuid: string; title: string; level: number }>; suggested: string[] };
  socialLinks: unknown; courses: unknown; internship: unknown; hobbies: unknown;
  languages: unknown[]; extraActivities: unknown; customSections: unknown[]; reference: unknown | null;
  template: string;   // 'TEMPLATE_2'
  color: string;      // 'PURPLE'
  sharedHash: string; sharedViews: number;
  updatedAt: string;
}

// ---------------------------------------------------------------- EMAIL RELAY
export interface EmailAccount {
  uuid: string;
  provider: 'managed' | string;
  address: string;         // <handle>@envelopad.com  - platform-issued relay inbox
  status: 'active' | string;
  priority: number;
  blockedAts: string[];
  createdAt: string; updatedAt: string;
}

// ---------------------------------------------------------------- TAXONOMY
export interface TaxonomySkill { uuid: string; lightcastId: string; name: string; level: number }
export interface TaxonomyTitle { uuid: string; name: string; level: number }
// GET /taxonomy/skills?search=      344,106 records  (Lightcast Open Skills seeded)
// GET /taxonomy/titles?search=       23,996 records  (user-generated, dirty)
// GET /taxonomy/industries              700 records
