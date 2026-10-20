-- Which added ("+1") columns each sheet was saved with, so empty or
-- single-destination columns survive a reload.

-- CreateTable
CREATE TABLE `sheet_extra_columns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT',
    `columnKey` VARCHAR(64) NOT NULL,
    `slotIndex` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sheet_extra_column_key`(`location`, `entryDate`, `shift`, `columnKey`, `slotIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill from the amounts already stored, so sheets saved before this
-- table keep their columns (Delivery (Out)'s first five live on its own row).
INSERT IGNORE INTO `sheet_extra_columns` (`location`, `entryDate`, `shift`, `columnKey`, `slotIndex`)
SELECT DISTINCT `location`, `entryDate`, `shift`, `columnKey`, `slotIndex` FROM `daily_stock_extra`;
