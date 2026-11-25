-- Admin recovery email. Additive: nullable columns plus a unique index, no rows rewritten.
ALTER TABLE `users`
    ADD COLUMN `email` VARCHAR(254) NULL,
    ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `pendingEmail` VARCHAR(254) NULL,
    ADD COLUMN `emailVerifyHash` VARCHAR(64) NULL,
    ADD COLUMN `emailVerifyExpiresAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);
