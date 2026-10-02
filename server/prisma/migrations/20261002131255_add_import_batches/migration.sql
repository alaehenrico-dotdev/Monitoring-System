-- AlterTable
ALTER TABLE `change_log` ADD COLUMN `importBatchId` INTEGER NULL;

-- CreateTable
CREATE TABLE `import_batches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `importedById` INTEGER NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `import_batches_location_entryDate_shift_idx`(`location`, `entryDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `change_log_importBatchId_idx` ON `change_log`(`importBatchId`);

-- AddForeignKey
ALTER TABLE `change_log` ADD CONSTRAINT `change_log_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `import_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_importedById_fkey` FOREIGN KEY (`importedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

