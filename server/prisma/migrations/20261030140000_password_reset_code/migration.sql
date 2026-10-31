-- Forgot password: a one-time code an administrator issues (SHA-256 hash only), when it
-- stops working, and how many wrong guesses it has absorbed. Additive: nullable columns and
-- a default, no rows are rewritten.
ALTER TABLE `users`
    ADD COLUMN `resetCodeHash` VARCHAR(64) NULL,
    ADD COLUMN `resetCodeExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `resetCodeAttempts` INTEGER NOT NULL DEFAULT 0;
