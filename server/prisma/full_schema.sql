SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `receipt_items`;
DROP TABLE IF EXISTS `receipts`;
DROP TABLE IF EXISTS `change_log`;
DROP TABLE IF EXISTS `manual_counts`;
DROP TABLE IF EXISTS `daily_offline_stock`;
DROP TABLE IF EXISTS `daily_online_stock`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `users`;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ONLINE_ENCODER', 'OFFLINE_ENCODER', 'SUPERVISOR_ADMIN') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sku` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `lowStockThreshold` DECIMAL(14, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_sku_key`(`sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_online_stock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT',
    `openingStock` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `stockInOffToOl` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `stockOutOlToOff` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `onlineStock` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `productionIn` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `fulfillmentOut` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `rts` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `remainingStock` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `encodedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_online_stock_entryDate_shift_idx`(`entryDate`, `shift`),
    UNIQUE INDEX `daily_online_stock_productId_entryDate_shift_key`(`productId`, `entryDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_offline_stock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT',
    `openingStock` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `stockInOlToOff` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `stockOutOffToOl` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `offlineStock` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `productionIn` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `deliveryOut` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `delivery1` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `delivery2` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `delivery3` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `delivery4` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `delivery5` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `backloads` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `upsellOut` INTEGER NOT NULL DEFAULT 0,
    `remainingStock` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `encodedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_offline_stock_entryDate_shift_idx`(`entryDate`, `shift`),
    UNIQUE INDEX `daily_offline_stock_productId_entryDate_shift_key`(`productId`, `entryDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `manual_counts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT',
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `systemRemainingStock` DECIMAL(14, 2) NOT NULL,
    `manualCount` DECIMAL(14, 2) NOT NULL,
    `variance` DECIMAL(14, 2) NOT NULL,
    `countedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `manual_counts_entryDate_idx`(`entryDate`),
    UNIQUE INDEX `manual_counts_productId_entryDate_shift_location_key`(`productId`, `entryDate`, `shift`, `location`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tableName` VARCHAR(191) NOT NULL,
    `recordId` INTEGER NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE') NOT NULL,
    `changedById` INTEGER NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `oldValue` JSON NULL,
    `newValue` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_online_stock` ADD CONSTRAINT `daily_online_stock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_online_stock` ADD CONSTRAINT `daily_online_stock_encodedById_fkey` FOREIGN KEY (`encodedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_offline_stock` ADD CONSTRAINT `daily_offline_stock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_offline_stock` ADD CONSTRAINT `daily_offline_stock_encodedById_fkey` FOREIGN KEY (`encodedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_counts` ADD CONSTRAINT `manual_counts_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_counts` ADD CONSTRAINT `manual_counts_countedById_fkey` FOREIGN KEY (`countedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_log` ADD CONSTRAINT `change_log_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;

