-- The first count of a product at a location is its opening balance: it seeds
-- the system rather than auditing it, so it carries a variance of 0 and is
-- left out of the variance reports. Counts saved before this column existed
-- were audits, so they stay FALSE.
ALTER TABLE `manual_counts` ADD COLUMN `isOpeningBalance` BOOLEAN NOT NULL DEFAULT false;
