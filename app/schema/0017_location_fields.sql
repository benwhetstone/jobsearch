-- 0017: city/state/country live under Location & Mobility, where people look
-- for them; the local job search runs around these values.
UPDATE profile_fields SET block_key='workPreferences', category_key='location',
  category_label='Location & Mobility', sort_order=30,
  help_text='Local jobs are searched around this city, and on-site roles far from it are filtered out.'
WHERE field_key='city';
UPDATE profile_fields SET block_key='workPreferences', category_key='location',
  category_label='Location & Mobility', sort_order=31
WHERE field_key='state';
UPDATE profile_fields SET block_key='workPreferences', category_key='location',
  category_label='Location & Mobility', sort_order=32
WHERE field_key='country';
