-- Awaiting-release items (finished goods with no label/sticker yet, which are not
-- stock until released) and monthly close (the lock layer above day locks).

-- CreateTable
CREATE TABLE `pending_releases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `productId` INTEGER NOT NULL,
    `quantity` DECIMAL(14, 2) NOT NULL,
    `madeDate` DATE NOT NULL,
    `madeShift` ENUM('MORNING', 'NIGHT') NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `status` ENUM('AWAITING', 'RELEASED', 'CANCELLED') NOT NULL DEFAULT 'AWAITING',
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `releasedAt` DATETIME(3) NULL,
    `releasedById` INTEGER NULL,
    `releasedEntryDate` DATE NULL,
    `releasedShift` ENUM('MORNING', 'NIGHT') NULL,
    `resolutionNote` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pending_releases_status_location_idx`(`status`, `location`),
    INDEX `pending_releases_productId_location_status_idx`(`productId`, `location`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `month_closures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `yearMonth` VARCHAR(7) NOT NULL,
    `isClosed` BOOLEAN NOT NULL DEFAULT true,
    `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedById` INTEGER NULL,
    `unlockedAt` DATETIME(3) NULL,
    `unlockedById` INTEGER NULL,
    `unlockReason` VARCHAR(500) NULL,

    UNIQUE INDEX `month_closures_yearMonth_key`(`yearMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pending_releases` ADD CONSTRAINT `pending_releases_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pending_releases` ADD CONSTRAINT `pending_releases_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pending_releases` ADD CONSTRAINT `pending_releases_releasedById_fkey` FOREIGN KEY (`releasedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `month_closures` ADD CONSTRAINT `month_closures_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `month_closures` ADD CONSTRAINT `month_closures_unlockedById_fkey` FOREIGN KEY (`unlockedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
