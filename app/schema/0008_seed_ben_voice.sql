-- Ben's answers to the Résumé & Voice block. These are DATA, not rules baked
-- into the writer: another tenant answering the same questions gets their own
-- voice out of the same code path.

INSERT OR REPLACE INTO profile_values (user_id, field_key, value_json, updated_at) VALUES
 ('user_ben', 'applicationFirstName', '"Benjamin"', '2026-07-28T00:00:00Z'),
 ('user_ben', 'professionalHeadline',
  '"An operations and data analyst who builds the reporting a team actually runs on: SQL models, pipeline analytics, and dashboards that change decisions."',
  '2026-07-28T00:00:00Z'),
 ('user_ben', 'careerNarrative',
  '"Career changer into data analytics from operations and public service. Do not apologise for it and do not hide it: lead with the analytical work already delivered, and let the earlier career read as evidence of judgement under pressure rather than as a gap."',
  '2026-07-28T00:00:00Z'),
 ('user_ben', 'employerDescriptions',
  '[{"employer": "Closing Day", "description": "a sales pipeline analytics platform"}, {"employer": "The South Shore Team", "description": "a residential real estate team doing $36 million in annual transaction volume"}]',
  '2026-07-28T00:00:00Z'),
 ('user_ben', 'signatureAchievements',
  '[{"result": "Designed the relational data model and scoring logic ranking client records on past performance", "metric": "52-table SQL pipeline", "employer": "Closing Day"}, {"result": "Built the reporting that tracks deal flow and conversion funnels", "metric": "$36 million in annual transaction volume", "employer": "The South Shore Team"}]',
  '2026-07-28T00:00:00Z'),
 ('user_ben', 'metricPhrasing',
  '[{"number": "$36 million", "phrasing": "always state it is annual transaction volume, never total or lifetime"}]',
  '2026-07-28T00:00:00Z'),
 ('user_ben', 'proudestWork',
  '"Designing and launching the 52-table SQL sales pipeline dashboard at Closing Day end to end: the data model, the scoring logic, and the reporting layer, then getting it adopted as the thing the team checks every morning."',
  '2026-07-28T00:00:00Z'),
 ('user_ben', 'writingTone', '"PLAIN_AND_DIRECT"', '2026-07-28T00:00:00Z'),
 ('user_ben', 'bulletStyle', '"OUTCOME_FIRST_WITH_METRICS"', '2026-07-28T00:00:00Z'),
 ('user_ben', 'coverLetterLength', '"FOUR_PARAGRAPHS"', '2026-07-28T00:00:00Z'),
 ('user_ben', 'avoidWords',
  '["passionate", "synergy", "leverage", "results-driven", "go-getter", "rockstar", "ninja", "thought leader"]',
  '2026-07-28T00:00:00Z'),
 ('user_ben', 'avoidEmDash', 'true', '2026-07-28T00:00:00Z'),
 ('user_ben', 'skillsSource', '"PROFILE_ONLY"', '2026-07-28T00:00:00Z'),
 ('user_ben', 'forbiddenSkills', '["AI", "Artificial Intelligence", "Machine Learning", "Lofty", "SkySlope", "CRM", "Google Ads"]', '2026-07-28T00:00:00Z'),
 ('user_ben', 'resumeTemplate', '"CLASSIC"', '2026-07-28T00:00:00Z');
