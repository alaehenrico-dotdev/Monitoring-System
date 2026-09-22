-- AlterTable
ALTER TABLE `daily_offline_stock` ADD COLUMN `upsellOut` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `delivery_destinations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `delivery_destinations_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offline_entry_deliveries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `offlineEntryId` INTEGER NOT NULL,
    `destinationId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `offline_entry_deliveries_offlineEntryId_destinationId_key`(`offlineEntryId`, `destinationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `offline_entry_deliveries` ADD CONSTRAINT `offline_entry_deliveries_offlineEntryId_fkey` FOREIGN KEY (`offlineEntryId`) REFERENCES `daily_offline_stock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offline_entry_deliveries` ADD CONSTRAINT `offline_entry_deliveries_destinationId_fkey` FOREIGN KEY (`destinationId`) REFERENCES `delivery_destinations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

