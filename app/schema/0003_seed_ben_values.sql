-- Phase 1 seed: Ben's account + profile values.
-- Ben is seeded as a CLAIMABLE admin user: password_hash is NULL, so the first
-- sign-up with his email sets his password and claims this pre-filled profile.
-- Everyone else signs up fresh into an empty profile.
--
-- Constraints from CLAUDE.md / PROJECT-BRIEF §1 are encoded here, not in prompt:
--   firstName = Benjamin; address = Apollo Beach (NOT Riverview); $60K salary floor;
--   veteran YES; disability YES; race/ethnicity = decline-to-state (auto-answered, never re-asked);
--   approved skills only (no AI, no Lofty/SkySlope/CRM/Google Ads); $36M annual SST volume;
--   Closing Day = sales pipeline analytics platform.
-- updated_at uses a fixed seed timestamp; the API overwrites it on every edit.

INSERT OR IGNORE INTO users (id, email, name, password_hash, password_salt, role, notify_email, created_at) VALUES ('user_ben', 'brwhetstone@gmail.com', 'Benjamin Whetstone', NULL, NULL, 'admin', 1, '2026-07-28T00:00:00Z');

INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'firstName', '"Benjamin"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'lastName', '"Whetstone"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'email', '"brwhetstone@gmail.com"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'phone', '"813-468-9832"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'address', '"6514 Maiden Sea Dr"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'city', '"Apollo Beach"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'state', '"FL"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'zip', '"33572"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'country', '"USA"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'citizenship', '"US Citizen"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'driverLicense', 'true', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'minimumAgeRequirement', 'true', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'linkedinProfile', '"linkedin.com/in/benwhetstone"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'portfolioLink', '"data.benwhetstone.info"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'veteranStatus', '"PROTECTED_VETERAN"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'disabilityStatus', '"YES"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'gender', '"PREFER_NOT_TO_SAY"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'lgbtqCommunity', '"PREFER_NOT_TO_SAY"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'raceEthnicity', '"PREFER_NOT_TO_SAY"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'legalSetup', '["US_FULL_TIME_EMPLOYEE_W2"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'residenceCountry', '"USA"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'workAuthorization', '["US_CITIZEN"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'visaSponsorship', '"NO"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'workingOutside', '["US"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'baseSalary', '60000', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'baseSalaryPeriod', '"YEARLY"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'employmentType', '["FULL_TIME"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'workFormat', '["REMOTE", "HYBRID", "ON_SITE"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'relocationReadiness', '"DEPENDS_ON_LOCATION"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'relocationArea', '["US_OPEN_WITHIN_STATE"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'noticePeriod', '"TWO_WEEKS"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'schedule', '"FLEXIBLE"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'benefits', '["HEALTH_INSURANCE", "RETIREMENT_PLAN", "PAID_TIME_OFF", "LEARNING_BUDGET"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'academicLevel', '"MASTER"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'fieldOfStudy', '["Public Administration", "Business Administration"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'institutionName', '"Troy University"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'seniorityLevel', '"ENTRY_WITH_DEGREE"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'leadershipExperience', 'true', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'processesAndMethodologies', '["TARGET_DRIVEN_KPI_OKR", "AGILE_SCRUM_KANBAN"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'technicalToolbox', '["SQL", "T-SQL", "Power BI", "Microsoft Excel", "Google Sheets", "Data Analysis", "Data Visualization"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'portfolioWebsites', '["data.benwhetstone.info"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'st_hardSkills', '[{"name": "SQL", "level": "ADVANCED"}, {"name": "T-SQL", "level": "ADVANCED"}, {"name": "Power BI", "level": "INTERMEDIATE"}, {"name": "Microsoft Excel", "level": "ADVANCED"}, {"name": "Google Sheets", "level": "ADVANCED"}, {"name": "Data Analysis", "level": "ADVANCED"}, {"name": "Data Visualization", "level": "INTERMEDIATE"}, {"name": "Relational Data Modeling", "level": "INTERMEDIATE"}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'st_softSkills', '[{"name": "Stakeholder Communication"}, {"name": "Requirements Gathering"}, {"name": "Attention to Detail"}, {"name": "Problem Solving"}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'st_jobTitles', '[{"name": "Data Analyst"}, {"name": "Operations & Data Analyst"}, {"name": "Business Analyst"}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'st_industryDomainKnowledge', '[{"name": "Real Estate"}, {"name": "SaaS"}, {"name": "Operations"}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'st_workExperiences', '[{"title": "Operations & Data Analyst", "employer": "Closing Day", "startDate": "2026-01", "endDate": "", "city": "Apollo Beach, FL", "description": "Sales pipeline analytics platform. Designed the relational data model and the scoring logic that ranks client records on past performance."}, {"title": "Operations & Data Analyst", "employer": "The South Shore Team", "startDate": "2016-01", "endDate": "", "city": "Apollo Beach, FL", "description": "Residential real estate sales team, $36 million in annual transaction volume. Reconcile CRM, MLS, transaction management, and bookkeeping into one set of numbers."}, {"title": "Police Officer", "employer": "St. Petersburg Police Department", "startDate": "2009", "endDate": "2017", "city": "St. Petersburg, FL", "description": "Sworn law enforcement officer under continuous federal background investigation."}, {"title": "Detention Deputy", "employer": "Hillsborough County Sheriff''s Office", "startDate": "2007", "endDate": "2009", "city": "Tampa, FL", "description": "Sworn detention deputy."}, {"title": "Network Technician", "employer": "Hostway Corp.", "startDate": "2004", "endDate": "2007", "city": "Tampa, FL", "description": "Network and field technician (also Field Technician, Bright House Networks)."}, {"title": "Signal Support Systems Specialist (MOS 25U)", "employer": "United States Army", "startDate": "2000", "endDate": "2004", "city": "", "description": "Maintained LAN servers and 200+ workstations to DoD security standards. Combat deployments supporting Operation Iraqi Freedom and Operation Enduring Freedom. Honorable discharge."}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'st_education', '[{"degree": "M.P.A., Public Administration", "school": "Troy University", "fieldOfStudy": "Public Administration", "startDate": "", "endDate": "2011", "city": ""}, {"degree": "Graduate Certificate, Justice Administration", "school": "University of South Florida", "fieldOfStudy": "Justice Administration", "startDate": "", "endDate": "2016", "city": "Tampa, FL"}, {"degree": "B.S., Business Administration & Management", "school": "University of Phoenix", "fieldOfStudy": "Business Administration & Management", "startDate": "", "endDate": "2007", "city": ""}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'st_professionalCredential', '[{"name": "Microsoft Certified: Azure Data Fundamentals (DP-900)"}, {"name": "Google Data Analytics Foundations"}, {"name": "Introduction to SQL and Intermediate SQL, DataCamp"}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'workLanguage', '[{"name": "English", "level": "NATIVE"}]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'companyMaturityFit', '"SOME_DEFINED_SOME_BUILDING"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'teamSetup', '"LEAN_TO_SPECIALISTS"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'teamSize', '"SMALL_TEAMS"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'culturalDiversityExperience', '"EXTENDED_PERIOD"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'areaOfInterest', '["Real Estate", "SaaS", "Analytics", "Operations"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'workStatus', '"SELF_EMPLOYED"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'jobSearchIntensity', '"ACTIVELY_APPLYING"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'jobSearchDuration', '"ONE_TO_THREE_MONTHS"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'personalDeadline', '"WITHIN_2_3_MONTHS"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'searchTrigger', '"CAREER_CHANGE"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'searchMotivation', '["HIGHER_PAY", "MORE_LEARNING_GROWTH", "MORE_STABILITY"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'motivationFit', '["FINANCIAL_STABILITY", "LEARNING_DEVELOPMENT", "NEW_DIRECTION"]', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'developmentFocus', '"GO_DEEPER"', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES ('user_ben', 'careerAspiration', '"Become a strong, well-rounded data analyst on a team where I can go deep on SQL, BI, and analytics engineering."', '2026-07-28T00:00:00Z');
