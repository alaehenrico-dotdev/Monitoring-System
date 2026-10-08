-- Extra input columns added to an Online/Offline grid column from its header's
-- right-click menu. The column they were added to keeps the total (it is still
-- an ordinary column on daily_online_stock / daily_offline_stock); these are
-- the individual amounts behind it, stored only when the encoder chooses
-- "Save individually".
CREATE TABLE `daily_stock_extra` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `productId` INTEGER NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT',
    `columnKey` VARCHAR(64) NOT NULL,
    `slotIndex` INTEGER NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `encodedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_stock_extra_slot_key`(`location`, `productId`, `entryDate`, `shift`, `columnKey`, `slotIndex`),
    INDEX `daily_stock_extra_location_entryDate_shift_idx`(`location`, `entryDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `daily_stock_extra`
    ADD CONSTRAINT `daily_stock_extra_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `daily_stock_extra_encodedById_fkey` FOREIGN KEY (`encodedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
