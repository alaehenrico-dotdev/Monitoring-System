-- Names typed into added ("+1") column headers, saved per sheet column.

-- CreateTable
CREATE TABLE `extra_column_labels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `location` ENUM('ONLINE', 'OFFLINE', 'TOTAL') NOT NULL,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL DEFAULT 'NIGHT',
    `columnKey` VARCHAR(64) NOT NULL,
    `slotIndex` INTEGER NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `updatedById` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `extra_column_label_key`(`location`, `entryDate`, `shift`, `columnKey`, `slotIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
