# GlobalWork.ai — DCP (Data Collection Profile) schema
Source: GET https://rjf-gateway-prod.globalwork.ai/api/v1/user/dcp/blocks/{blockName}/fields
Values stripped; schema only.

## Endpoint: /api/v1/user/dcp/completion  (returns)
{ score: int(0-100), title: {uuid,name,level}, blocks: { <blockKey>: {filledCount,totalCount} } }

Observed: score 79. Blocks/totals:
  personalDetails 27 | workEligibility 5 | workPreferences 22
  professionalProfile 20 | company 7 | career 11        => 92 fields total

## Field object shape
{
  fieldKey: string,
  fieldType: "string" | "number" | "boolean" | "string_array" | "object_array",
  question: string | null,          // human-readable, drives BOTH onboarding UI and ATS answer lookup
  categoryUuid: uuid,
  categoryKey: string,              // UI grouping within a block
  options: string[] | [],           // controlled enum
  isMultiSelect: boolean,
  isMatchingParam: boolean,         // does this field feed the job match score
  storageTarget: "FIELD_VALUE" | ...,
  order: int
}

## BLOCK: personalDetails (27) — categories: personalInfo, digitalPresence, general
address              string   -  personalInfo     Home address
citizenship          string   -  personalInfo     What citizenship do you currently hold?
city                 string   -  personalInfo     City
country              string   -  personalInfo     Which country are you based in?              (249 ISO-3 opts)
disabilityStatus     string   -  personalInfo     Any disability status to mention?            NO,YES,PREFER_NOT_TO_SAY
driverExperience     number   -  personalInfo     (null)
driverLicense        boolean  -  personalInfo     Do you have a valid driver's license?
email                string   M  personalInfo     What is your best contact email?
firstName            string   M  personalInfo     What is your first name?
gender               string   -  personalInfo     What is your gender?                          (4)
lastName             string   M  personalInfo     What is your last name?
lgbtqCommunity       string   -  personalInfo     Do you identify as a member of the LGBTQ+ community?  (3)
linkedinProfile      string   M  digitalPresence  What's your LinkedIn profile link?
middleName           string   -  personalInfo     Any middle name?
minimumAgeRequirement boolean -  personalInfo     Are you at least 18 years old?
nationality          string   -  personalInfo     (null)
otherSocialHandles   object_array - digitalPresence  Any other professional social links?
personalInterests    string_array - general       What are your main hobbies or interests?
phone                string   M  personalInfo     What is your phone number?
publicActivity       string_array - general       Any articles, talks, or public projects?
raceEthnicity        string   -  personalInfo     What is your race or ethnicity?               (7)
selfieImage          string   -  personalInfo     Upload your photo
sexualOrientation    string   -  personalInfo     What is your sexual orientation?              (6)
state                string   -  personalInfo     State
veteranStatus        string   -  personalInfo     Are you a military veteran?                   (4)
volunteeringAndCauses string_array - general      Do you support any social causes?
zip                  string   -  personalInfo     Zip/postal code

NOTE: the EEO/demographic fields (disability, gender, race, sexual orientation, veteran, LGBTQ)
exist solely to auto-answer the US EEO section of ATS forms. All have PREFER_NOT_TO_SAY.

## BLOCK: workEligibility (5) — category: residency  [ALL matching params]
legalSetup        string_array M  Which work options are you open to?  (20)
   US_FULL_TIME_EMPLOYEE_W2, US_INDEPENDENT_CONTRACTOR_1099, US_EMPLOYER_OF_RECORD,
   US_OWN_REGISTERED_COMPANY, EU_*, UK_*, CA_*, OTHER_* (same 4 shapes per region)
residenceCountry  string       M  What is your current country of residence? (249)
visaSponsorship   string       M  Will you require visa sponsorship...? (region-aware question text)
workAuthorization string_array M  What is your current work authorization status in US/EU/UK/CA? (24)
   US_CITIZEN, US_PERMANENT_RESIDENT, US_VALID_WORK_VISA, US_STUDENT_VISA_OPT_CPT,
   US_OTHER_WORK_AUTH, US_NOT_AUTHORIZED, + EU_/UK_/CA_ equivalents
workingOutside    string_array M  Are you open to working with companies outside the US/EU/UK/CA?
   EU, US, UK, CANADA, LATAM, GLOBAL_REMOTE_ONLY

## BLOCK: workPreferences (22) — categories: compensationAndBenefits, locationAndMobility, employmentAndAvailability
baseSalary                     number       M  What's your minimum expected salary?
baseSalaryPeriod               string       M  (Period)  HOURLY,DAILY,WEEKLY,MONTHLY,YEARLY
benefits                       string_array -  What benefits matter most to you?
   FLEXIBLE_PTO, HEALTH_INSURANCE, GYM_WELLNESS, LEARNING_BUDGET, PAID_TIME_OFF,
   HOME_OFFICE_BUDGET, EQUIPMENT_PROVIDED, RETIREMENT_PLAN, PARENTAL_LEAVE,
   STOCK_OPTIONS, SIGN_ON_BONUS
daysInOffice                   number       -  If Hybrid, how many days in the office?  1,2,3,4
employmentType                 string_array M  What type of work are you open to?
   FULL_TIME, PART_TIME, CONTRACT_FREELANCE, INTERNSHIP
noticePeriod                   string       -  What is your current notice period?
   AVAILABLE_NOW, TWO_WEEKS, ONE_MONTH, TWO_MONTHS, THREE_MONTHS_PLUS
oteMin                         number       -  Minimum expected OTE salary?
percentageOfTravel             number       -  How much travel time is okay for you?
performanceBasedBonus          string       -  NO, YES, NOT_A_PRIORITY
preferredCurrency              string       -  What's your preferred currency?
ratePerHour                    number       M  (null)
relocationArea                 string_array M  Relocation flexibility within the US? (11)
   US_OPEN_WITHIN_STATE, US_OPEN_ANYWHERE_US, NOT_OPEN, EU_*, CA_*, UK_*, OPEN_ANYWHERE_WORLDWIDE
relocationPackageRequirements  string_array -  VISA_SPONSORSHIP, MOVING_EXPENSES, TEMPORARY_HOUSING, ONE_TIME_BONUS, NONE
relocationReadiness            string       M  YES, NO, DEPENDS_ON_LOCATION
schedule                       string       -  FLEXIBLE, FIXED_NO_OVERTIME, FIXED_WITH_OVERTIME, NO_NIGHT_SHIFTS
specificRemoteRequirements     string_array -  FULLY_EQUIPPED, NEED_LAPTOP, NEED_FULL_SETUP
variableSalaryIsPercentage     boolean      -  (null)
variableSalaryStructure        string       -  PERCENT_OF_SALES_REVENUE, PERCENT_OF_BASE_SALARY, FIXED_AMOUNT
variableSalaryTargetValue      number       -  What is your expected target?
workFormat                     string_array M  REMOTE, HYBRID, ON_SITE
workingHoursOverlapStartDate   string       -  Available time range (start)
workingHoursOverlapEndDate     string       -  Available time range (end)

## BLOCK: professionalProfile (20) — categories: education, roleAndSeniority, skillsAndCompetency, employmentHistory
academicLevel               string       M  Highest level of education?
   NO_FORMAL, HIGH_SCHOOL_GED, ASSOCIATE_DEGREE, BACHELOR, MASTER, PROFESSIONAL_DEGREE, DOCTORAL
averageGradeScore           number       -  Average academic grade at graduation?
fieldOfStudy                string_array M  Main area of study?
institutionName             string       -  Name of institution
internalSeniorityScore      string       -  (null)   <-- system-computed, not user-facing
leadershipExperience        boolean      M  Experience leading people?
leadershipScope             string_array -  STANDARD_TEAM, DISTRIBUTED_REMOTE, DIVERSE_INTERNATIONAL, LEADING_LEADERS
numberOfDirectReports       string       -  1-5, 6-15, 16-50, 50-100, 100+
portfolioWebsites           string_array -  Where can we see examples of your work?
processesAndMethodologies   string_array -  ADAPT_TO_EVERYTHING, AGILE_SCRUM_KANBAN, WATERFALL,
                                            TARGET_DRIVEN_KPI_OKR, DESIGN_THINKING, LEAN, NONE
seniorityLevel              string       M  NO_SKILLS, ENTRY_WITH_DEGREE, JUNIOR, MIDDLE, SENIOR,
                                            LEAD_MANAGER, DIRECTOR, VP_EXECUTIVE_C_SUITE
technicalToolbox            string_array M  What specific tools or software do you use?
workLanguage                object_array M  Which languages can you work in?
yearsInLeadership           number       -  How many years in leadership roles?
st_jobTitles                object_array -  What is your desired job title?           [taxonomy-backed]
st_hardSkills               object_array M  List all your professional skills          [taxonomy-backed]
st_softSkills               object_array -  Key soft skills?                           [taxonomy-backed]
st_workExperiences          object_array -  Tell us about your work experience.        [structured]
st_industryDomainKnowledge  object_array M  Which industries & domains do you specialize in? [taxonomy-backed]
st_professionalCredential   object_array -  Credentials, certificates, licenses, memberships [taxonomy-backed]

  The st_ prefix = "structured/taxonomy" entities with UUIDs, resolved via /api/v1/taxonomy/*

## BLOCK: company (7) — categories: personaFit, workStyle, teamFit
areaOfInterest              string_array -  Domains you'd like to work in?
companyMaturityExperience   string       -  (null)
companyMaturityFit          string       -  Rank these work environments most->least comfortable
   CLEAR_PROCESSES_STABLE, MOSTLY_STRUCTURED, SOME_DEFINED_SOME_BUILDING,
   FREQUENT_CHANGES_ADAPT, DECISIONS_WITHOUT_CONTEXT, BUILD_FROM_SCRATCH
culturalDiversityExperience string       -  EXTENDED_PERIOD, BRIEFLY, NO
teamMainLanguage            string       -  Does the team's working language matter?
teamSetup                   string       -  WITH_SPECIALISTS, SOLE_SPECIALIST, LEAN_TO_SPECIALISTS, LEAN_TO_SOLE
teamSize                    string       -  BIG_TEAMS, SMALL_TEAMS, INDEPENDENT

## BLOCK: career (11) — category: careerFit  [almost all matching params]
careerAspiration   string       -  Looking ahead a few years, what would a good outcome look like?
desperateScore     string       M  (null)   <-- system-computed urgency score
developmentFocus   string       -  GO_DEEPER, MORE_IC, PEOPLE_LEADERSHIP, COMFORTABLE_NO_CHANGE
dreamCompany       string_array M  Companies you'd be especially interested in?
jobSearchDuration  string       M  JUST_STARTED, ONE_TO_THREE_MONTHS, THREE_TO_SIX_MONTHS,
                                   MORE_THAN_SIX_MONTHS, NOT_ACTIVELY_LOOKING
jobSearchIntensity string       M  ACTIVELY_APPLYING, OPEN_BUT_SELECTIVE, JUST_EXPLORING
motivationFit      string_array M  FINANCIAL_STABILITY, HIGHER_INCOME, LEARNING_DEVELOPMENT,
                                   BETTER_WORK_LIFE_BALANCE, INTERESTING_MEANINGFUL, NEW_DIRECTION
personalDeadline   string       M  ASAP, WITHIN_2_3_MONTHS, THIS_YEAR_SOONER, NO_DEADLINE
searchMotivation   string_array M  HIGHER_PAY, MORE_LEARNING_GROWTH, MORE_OWNERSHIP, BETTER_BALANCE,
                                   MORE_FLEXIBILITY, STRONGER_TEAM_LEADERSHIP, MORE_INTERESTING_WORK,
                                   MORE_STABILITY, MEANING... (11)
searchTrigger      string       M  Main reason you're looking right now? (6)
workStatus         string       M  What is your current work status? (4)
