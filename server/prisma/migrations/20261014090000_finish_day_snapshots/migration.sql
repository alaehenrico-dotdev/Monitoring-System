-- Encoder "Finish day": entries-only locks and the frozen Daily Report snapshot.

-- AlterTable
ALTER TABLE `day_closures` ADD COLUMN `entriesOnly` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `daily_report_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryDate` DATE NOT NULL,
    `payload` JSON NOT NULL,
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `savedById` INTEGER NULL,

    UNIQUE INDEX `daily_report_snapshots_entryDate_key`(`entryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_report_snapshots` ADD CONSTRAINT `daily_report_snapshots_savedById_fkey` FOREIGN KEY (`savedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
