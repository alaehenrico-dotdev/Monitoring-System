-- AlterTable
ALTER TABLE `daily_offline_stock` ADD COLUMN `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT';

-- AlterTable
ALTER TABLE `daily_online_stock` ADD COLUMN `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT';

-- AlterTable
ALTER TABLE `manual_counts` ADD COLUMN `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT';

-- CreateIndex
CREATE UNIQUE INDEX `daily_offline_stock_productId_entryDate_shift_key` ON `daily_offline_stock`(`productId`, `entryDate`, `shift`);

-- CreateIndex
CREATE UNIQUE INDEX `daily_online_stock_productId_entryDate_shift_key` ON `daily_online_stock`(`productId`, `entryDate`, `shift`);

-- CreateIndex
CREATE UNIQUE INDEX `manual_counts_productId_entryDate_shift_location_key` ON `manual_counts`(`productId`, `entryDate`, `shift`, `location`);

-- DropIndex
DROP INDEX `daily_offline_stock_productId_entryDate_key` ON `daily_offline_stock`;

-- DropIndex
DROP INDEX `daily_online_stock_productId_entryDate_key` ON `daily_online_stock`;

-- DropIndex
DROP INDEX `manual_counts_productId_entryDate_location_key` ON `manual_counts`;
