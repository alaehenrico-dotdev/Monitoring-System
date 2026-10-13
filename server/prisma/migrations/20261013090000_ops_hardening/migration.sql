-- Day locking, client error reporting, idempotent saves, change-log archive,
-- correction workflow and backup history.

-- CreateTable
CREATE TABLE `day_closures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL,
    `isClosed` BOOLEAN NOT NULL DEFAULT true,
    `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedById` INTEGER NULL,
    `unlockedAt` DATETIME(3) NULL,
    `unlockedById` INTEGER NULL,
    `unlockReason` VARCHAR(500) NULL,

    UNIQUE INDEX `day_closures_entryDate_shift_key`(`entryDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_errors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `page` VARCHAR(300) NOT NULL,
    `message` VARCHAR(1000) NOT NULL,
    `stack` TEXT NULL,
    `source` VARCHAR(32) NOT NULL,
    `appVersion` VARCHAR(40) NULL,
    `userAgent` VARCHAR(300) NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_errors_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL,
    `userId` INTEGER NOT NULL,
    `method` VARCHAR(10) NOT NULL,
    `path` VARCHAR(300) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `statusCode` INTEGER NULL,
    `responseBody` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idempotency_keys_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `idempotency_keys_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_log_archive` (
    `id` INTEGER NOT NULL,
    `tableName` VARCHAR(191) NOT NULL,
    `recordId` INTEGER NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE') NOT NULL,
    `changedById` INTEGER NULL,
    `changedAt` DATETIME(3) NOT NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `importBatchId` INTEGER NULL,
    `causedById` INTEGER NULL,
    `archivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `change_log_archive_changedAt_idx`(`changedAt`),
    INDEX `change_log_archive_tableName_recordId_id_idx`(`tableName`, `recordId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `correction_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tableName` VARCHAR(40) NOT NULL,
    `recordId` INTEGER NOT NULL,
    `field` VARCHAR(64) NOT NULL,
    `beforeValue` VARCHAR(64) NOT NULL,
    `proposedValue` VARCHAR(64) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `requestedById` INTEGER NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedById` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(500) NULL,
    `appliedBefore` VARCHAR(64) NULL,

    INDEX `correction_requests_status_requestedAt_idx`(`status`, `requestedAt`),
    INDEX `correction_requests_tableName_recordId_idx`(`tableName`, `recordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `correction_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `event` VARCHAR(20) NOT NULL,
    `byId` INTEGER NULL,
    `note` VARCHAR(500) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `correction_events_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backup_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileName` VARCHAR(200) NOT NULL,
    `trigger` VARCHAR(20) NOT NULL,
    `status` ENUM('OK', 'FAILED', 'INVALID') NOT NULL,
    `sizeBytes` BIGINT NULL,
    `sha256` VARCHAR(64) NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verifiedAt` DATETIME(3) NULL,
    `createdById` INTEGER NULL,

    INDEX `backup_records_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `day_closures` ADD CONSTRAINT `day_closures_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `day_closures` ADD CONSTRAINT `day_closures_unlockedById_fkey` FOREIGN KEY (`unlockedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_errors` ADD CONSTRAINT `client_errors_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `correction_requests` ADD CONSTRAINT `correction_requests_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `correction_requests` ADD CONSTRAINT `correction_requests_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `correction_events` ADD CONSTRAINT `correction_events_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `correction_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `correction_events` ADD CONSTRAINT `correction_events_byId_fkey` FOREIGN KEY (`byId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
