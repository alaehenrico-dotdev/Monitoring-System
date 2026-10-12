-- Session revocation: tokens carry the account's tokenVersion; an admin
-- password reset bumps it, signing out sessions opened with the old password.
ALTER TABLE `users` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;

-- Serves "which products already have a count at this location" (the
-- opening-balance check), which the unique key (productId first) cannot.
CREATE INDEX `manual_counts_location_productId_idx` ON `manual_counts`(`location`, `productId`);

-- publishedById was a bare integer; make it a real reference like every other
-- user column. SET NULL keeps the count if a user row is ever removed.
ALTER TABLE `manual_counts` ADD CONSTRAINT `manual_counts_publishedById_fkey` FOREIGN KEY (`publishedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
