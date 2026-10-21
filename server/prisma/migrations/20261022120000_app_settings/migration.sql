-- System-wide switches an admin can change in Settings (key -> value).

-- CreateTable
CREATE TABLE `app_settings` (
    `key` VARCHAR(80) NOT NULL,
    `value` VARCHAR(200) NOT NULL,
    `updatedById` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
