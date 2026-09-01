-- 0016: human copy for cryptic enum questions (applies to every tenant —
-- these are field definitions, not user data).
UPDATE profile_fields SET
  question = 'Do you want to work alongside other specialists, or own your area solo?',
  help_text = 'Some people want peers who share their craft; others want to be the one specialist who owns it. The "prefer" options mean a lean, not a hard requirement.'
WHERE field_key = 'teamSetup';
UPDATE profile_fields SET
  help_text = 'Big team, small team, or mostly working on your own.'
WHERE field_key = 'teamSize';
