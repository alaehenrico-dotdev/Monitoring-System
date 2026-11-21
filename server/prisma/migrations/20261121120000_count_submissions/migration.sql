-- An auditor's blind count of one sheet, staged here (never in manual_counts) until an admin accepts it.

-- CreateTable
CREATE TABLE `manual_count_submissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `auditorId` INTEGER NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED') NOT NULL DEFAULT 'DRAFT',
    `submittedAt` DATETIME(3) NULL,
    `reopenedAt` DATETIME(3) NULL,
    `reopenedById` INTEGER NULL,
    `reopenReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `manual_count_submissions_entryDate_shift_idx`(`entryDate`, `shift`),
    UNIQUE INDEX `manual_count_submissions_auditorId_entryDate_shift_key`(`auditorId`, `entryDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `manual_count_submission_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `submissionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `qty` DECIMAL(14, 2) NULL,
    `note` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `manual_count_submission_lines_productId_idx`(`productId`),
    UNIQUE INDEX `manual_count_submission_lines_submissionId_productId_locatio_key`(`submissionId`, `productId`, `location`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `manual_count_submissions` ADD CONSTRAINT `manual_count_submissions_auditorId_fkey` FOREIGN KEY (`auditorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_count_submission_lines` ADD CONSTRAINT `manual_count_submission_lines_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `manual_count_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_count_submission_lines` ADD CONSTRAINT `manual_count_submission_lines_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

