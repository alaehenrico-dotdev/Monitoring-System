-- Which day of the week the scheduled Google Drive backup runs. 5 (Friday, UTC) at the
-- default 18:00 UTC is Saturday 2:00 AM in the Philippines. Existing connections get it too.

-- AlterTable
ALTER TABLE `drive_connection` ADD COLUMN `backupWeekday` INTEGER NOT NULL DEFAULT 5;
