-- An encoder's request for a finished entry page to be unlocked.

-- CreateTable
CREATE TABLE `unlock_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT',
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `requestedById` INTEGER NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `unlock_requests_status_requestedAt_idx`(`status`, `requestedAt`),
    INDEX `unlock_requests_entryDate_shift_location_idx`(`entryDate`, `shift`, `location`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
