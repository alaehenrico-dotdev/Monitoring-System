-- Manual counts are an audit only. A supervisor can opt a published sheet in to
-- also become the next day's opening stock; that choice is stored per count.
-- Counts that existed before this column stay FALSE (audit only).
ALTER TABLE `manual_counts` ADD COLUMN `appliedToOpening` BOOLEAN NOT NULL DEFAULT false;

-- Opening stock typed (or imported) by an encoder is theirs: the carry-forward
-- and an applied count leave it alone. Existing rows stay FALSE (carried).
ALTER TABLE `daily_online_stock` ADD COLUMN `openingManual` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `daily_offline_stock` ADD COLUMN `openingManual` BOOLEAN NOT NULL DEFAULT false;
