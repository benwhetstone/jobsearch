-- Résumé & Voice block. Everything the document writer needs in order to produce
-- a résumé and cover letter that sound like THIS person, asked as ordinary
-- questions. Ben's answers are seeded in 0008; every other tenant answers the
-- same questions and gets their own voice. Nothing about voice is hardcoded.

INSERT OR REPLACE INTO profile_blocks (key, label, description, sort_order) VALUES
 ('resumeVoice', 'Résumé & Voice',
  'How your résumé and cover letters should sound. Answer once: every application is written from these.', 7);

INSERT OR REPLACE INTO profile_fields (field_key, block_key, category_key, category_label, field_type, question, options_json, is_multi_select, is_required, is_matching_input, storage_target, help_text, sort_order) VALUES
-- how you are named and framed
 ('applicationFirstName', 'resumeVoice', 'voiceIdentity', 'How You Are Presented', 'string',
  'What first name should appear on applications?', '[]', 0, 1, 0, 'FIELD_VALUE',
  'Some people apply under a formal name and go by another day to day.', 1),
 ('professionalHeadline', 'resumeVoice', 'voiceIdentity', 'How You Are Presented', 'string',
  'In one line, what do you want to be known as?', '[]', 0, 1, 0, 'FIELD_VALUE',
  'This shapes the résumé summary. Example: an operations analyst who builds the reporting a team runs on.', 2),
 ('careerNarrative', 'resumeVoice', 'voiceIdentity', 'How You Are Presented', 'string',
  'If your background is not a straight line, how should that be framed?', '[]', 0, 0, 0, 'FIELD_VALUE',
  'Career changers get screened out by silence, not by the change itself. Say how you want it handled.', 3),
 ('employerDescriptions', 'resumeVoice', 'voiceIdentity', 'How You Are Presented', 'object_array',
  'Do any of your employers need a specific description?', '[]', 0, 0, 0, 'FIELD_VALUE',
  'For companies nobody would recognise. Each entry: employer and the exact wording to use.', 4),

-- the achievements you want in front of a reader
 ('signatureAchievements', 'resumeVoice', 'voiceEvidence', 'Your Evidence', 'object_array',
  'Which results should appear on every résumé?', '[]', 0, 1, 0, 'FIELD_VALUE',
  'Each entry: the result, the number, and the employer. These get placed first when relevant.', 5),
 ('metricPhrasing', 'resumeVoice', 'voiceEvidence', 'Your Evidence', 'object_array',
  'Are there numbers that must always be phrased a certain way?', '[]', 0, 0, 0, 'FIELD_VALUE',
  'Each entry: the number and the required wording. Stops a figure being quoted misleadingly.', 6),
 ('proudestWork', 'resumeVoice', 'voiceEvidence', 'Your Evidence', 'string',
  'What piece of work are you proudest of, and why?', '[]', 0, 0, 0, 'FIELD_VALUE',
  'Cover letters draw on this when the posting lines up.', 7),

-- how the writing should sound
 ('writingTone', 'resumeVoice', 'voiceStyle', 'How It Should Read', 'string',
  'How should your writing come across?', '["PLAIN_AND_DIRECT","WARM_AND_PERSONABLE","FORMAL_AND_PRECISE","CONFIDENT_AND_PUNCHY"]',
  0, 1, 0, 'FIELD_VALUE', 'Sets sentence length and word choice throughout.', 8),
 ('bulletStyle', 'resumeVoice', 'voiceStyle', 'How It Should Read', 'string',
  'How should résumé bullets be built?', '["OUTCOME_FIRST_WITH_METRICS","ACTION_THEN_RESULT","SCOPE_AND_RESPONSIBILITY","SHORT_AND_PUNCHY"]',
  0, 1, 0, 'FIELD_VALUE', 'Outcome first is the strongest default: the number leads, the task follows.', 9),
 ('coverLetterLength', 'resumeVoice', 'voiceStyle', 'How It Should Read', 'string',
  'How long should a cover letter be?', '["THREE_TIGHT_PARAGRAPHS","FOUR_PARAGRAPHS","ONE_PAGE","SHORT_NOTE"]',
  0, 0, 0, 'FIELD_VALUE', NULL, 10),
 ('avoidWords', 'resumeVoice', 'voiceStyle', 'How It Should Read', 'string_array',
  'Any words or phrases that should never appear?', '[]', 0, 0, 0, 'FIELD_VALUE',
  'Add anything that does not sound like you. These are enforced, not suggested.', 11),
 ('avoidEmDash', 'resumeVoice', 'voiceStyle', 'How It Should Read', 'boolean',
  'Should em dashes be avoided?', '[]', 0, 0, 0, 'FIELD_VALUE',
  'Em dashes read as machine-written to a lot of screeners.', 12),
 ('skillsSource', 'resumeVoice', 'voiceStyle', 'How It Should Read', 'string',
  'Where may résumé skills come from?', '["PROFILE_ONLY","PROFILE_PLUS_CLOSE_MATCHES"]', 0, 1, 0, 'FIELD_VALUE',
  'Profile only is the honest setting: a skill never appears because the posting asked for it.', 13),
 ('forbiddenSkills', 'resumeVoice', 'voiceStyle', 'How It Should Read', 'string_array',
  'Are there skills or tools you do NOT want listed?', '[]', 0, 0, 0, 'FIELD_VALUE',
  'Things you can do but do not want to be hired for.', 14),

-- look
 ('resumeTemplate', 'resumeVoice', 'voiceLook', 'Look', 'string',
  'Which résumé design do you want?', '["CLASSIC","MODERN","COMPACT","EXECUTIVE"]', 0, 0, 0, 'FIELD_VALUE',
  'Classic is a traditional single column. Modern has a sidebar. Compact fits dense history on one page. Executive is a wider, senior layout.', 15);
