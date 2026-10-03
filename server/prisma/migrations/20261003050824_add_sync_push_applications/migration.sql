-- CreateTable
CREATE TABLE `sync_push_applications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `localId` VARCHAR(191) NOT NULL,
    `tableName` VARCHAR(191) NOT NULL,
    `serverId` INTEGER NOT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sync_push_applications_localId_key`(`localId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
