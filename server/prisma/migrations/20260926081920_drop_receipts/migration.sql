-- DropForeignKey
ALTER TABLE `receipt_items` DROP FOREIGN KEY `receipt_items_productId_fkey`;

-- DropForeignKey
ALTER TABLE `receipt_items` DROP FOREIGN KEY `receipt_items_receiptId_fkey`;

-- DropForeignKey
ALTER TABLE `receipts` DROP FOREIGN KEY `receipts_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `receipts` DROP FOREIGN KEY `receipts_salesRepId_fkey`;

-- DropTable
DROP TABLE `receipt_items`;

-- DropTable
DROP TABLE `receipts`;

