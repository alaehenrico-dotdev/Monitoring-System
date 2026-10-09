-- A manual count carries forward into the next period's opening stock only once
-- it is published. Counts saved before this column existed already carried
-- forward, so they are marked published as of their last change.
ALTER TABLE `manual_counts` ADD COLUMN `publishedAt` DATETIME(3) NULL, ADD COLUMN `publishedById` INTEGER NULL;
UPDATE `manual_counts` SET `publishedAt` = `updatedAt`;
