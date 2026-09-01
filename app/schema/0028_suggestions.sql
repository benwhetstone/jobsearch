-- 0028: Cowork suggestions in Jobs For You.
--
-- After its sweep, Cowork writes curated picks as matches with origin='cowork'
-- (the site's own daily sweep uses origin='auto' and its scoped DELETE never
-- touches 'cowork' rows, so suggestions survive). `note` carries Cowork's
-- one-line "why it fits" onto the card.
ALTER TABLE matches ADD COLUMN note TEXT;
