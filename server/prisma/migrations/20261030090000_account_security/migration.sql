-- Account security: forced password change and two-step verification (TOTP).
-- Additive only: every new column is nullable or has a default, no rows are rewritten.
ALTER TABLE `users`
    ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `totpSecret` VARCHAR(255) NULL,
    ADD COLUMN `totpEnabledAt` DATETIME(3) NULL,
    ADD COLUMN `totpLastStep` INTEGER NULL,
    ADD COLUMN `recoveryCodes` JSON NULL;
