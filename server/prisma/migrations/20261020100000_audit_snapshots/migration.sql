-- A frozen copy of each Publish, for Audit History.

-- CreateTable
CREATE TABLE `audit_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryDate` DATE NOT NULL,
    `shift` ENUM('MORNING', 'NIGHT') NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL,
    `publishedById` INTEGER NULL,
    `appliedToOpening` BOOLEAN NOT NULL DEFAULT false,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_snapshots_entryDate_shift_idx`(`entryDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
