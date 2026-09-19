-- AlterTable
ALTER TABLE `products` ADD COLUMN `sku` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `products_sku_key` ON `products`(`sku`);
