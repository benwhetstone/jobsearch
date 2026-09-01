-- Swiss grid template option + the canonical-summary pattern from the voice
-- study: a user-approved base summary that tailoring ADAPTS rather than
-- replaces. Ben's answers seeded; other tenants fill their own.

UPDATE profile_fields
   SET options_json = '["CLASSIC","MODERN","COMPACT","EXECUTIVE","SWISS"]',
       help_text = 'Classic is a traditional single column. Modern has blue accents. Compact fits dense history on one page. Executive is a wide senior layout. Swiss is a designer grid with margin labels.'
 WHERE field_key = 'resumeTemplate';

INSERT OR REPLACE INTO profile_fields (field_key, block_key, category_key, category_label, field_type, question, options_json, is_multi_select, is_required, is_matching_input, storage_target, help_text, sort_order) VALUES
 ('canonicalSummary', 'resumeVoice', 'voiceIdentity', 'How You Are Presented', 'string',
  'If you have a summary paragraph you already love, paste it here.', '[]', 0, 0, 0, 'FIELD_VALUE',
  'Tailoring will adapt this approved summary per job instead of writing a new one from scratch. Leave blank to let each resume write its own.', 4);

INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES
 ('user_ben', 'resumeTemplate', '"SWISS"', '2026-07-28T00:00:00Z'),
 ('user_ben', 'canonicalSummary',
  '"Builds dashboards, defines KPIs, and delivers business reporting in SQL and Power BI. Designed the SQL data model powering a sales pipeline dashboard with deal flow tracking, conversion funnels, goal pacing, and commission forecasting for residential real estate teams. Ten years owning the data infrastructure for a $36 million annual transaction volume real estate operation across four systems (CRM, MLS, transaction management, bookkeeping): reconciling cross-system discrepancies, building recurring reports for leadership and compliance, and translating business questions into actionable analysis for non-technical stakeholders. Army veteran."',
  '2026-07-28T00:00:00Z');

-- voice.md rejected registers that are enforceable as text rules for Ben
INSERT INTO writing_rules (user_id, pattern, requires, forbids, message, severity, created_at)
SELECT 'user_ben', '\b(responsible for|helped with|tasked with|involved in)\b', NULL, 1,
       'Passive constructions are banned: every bullet starts with a verb.', 'fail', '2026-07-28T00:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM writing_rules WHERE user_id='user_ben' AND pattern LIKE '%responsible for%');
INSERT INTO writing_rules (user_id, pattern, requires, forbids, message, severity, created_at)
SELECT 'user_ben', '(career.chang|transitioning from)', NULL, 1,
       'Transition is implied, never announced.', 'fail', '2026-07-28T00:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM writing_rules WHERE user_id='user_ben' AND pattern LIKE '%transitioning%');
