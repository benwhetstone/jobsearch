-- Ben's own writing rules. Tenant-specific by design: every other user starts
-- with an empty rule set and adds their own.
DELETE FROM writing_rules WHERE user_id = 'user_ben';
INSERT INTO writing_rules (user_id, pattern, requires, forbids, message, severity, created_at) VALUES
 ('user_ben', '\$36\s?(m|million)', 'annual', 0, '$36 million must be described as annual transaction volume.', 'fail', '2026-07-28T00:00:00Z'),
 ('user_ben', 'closing day', 'sales pipeline analytics platform', 0, 'Closing Day is described as a sales pipeline analytics platform.', 'warn', '2026-07-28T00:00:00Z'),
 ('user_ben', '\b(lofty|skyslope|google ads)\b', NULL, 1, 'Lofty, SkySlope and Google Ads must not appear on the résumé.', 'fail', '2026-07-28T00:00:00Z'),
 ('user_ben', '\b(ai|artificial intelligence|machine learning)\b', NULL, 1, 'AI must never appear as a skill or a differentiator.', 'fail', '2026-07-28T00:00:00Z');
INSERT OR REPLACE INTO user_settings (user_id, resume_template, auto_sweep, updated_at)
 VALUES ('user_ben', 'classic', 1, '2026-07-28T00:00:00Z');
