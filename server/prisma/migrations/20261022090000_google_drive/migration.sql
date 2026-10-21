-- Google Drive connection (one row) and the log of files sent to it.

-- CreateTable
CREATE TABLE `drive_connection` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `accountEmail` VARCHAR(200) NULL,
    `refreshTokenEnc` TEXT NOT NULL,
    `backupFolderId` VARCHAR(100) NOT NULL,
    `exportFolderId` VARCHAR(100) NOT NULL,
    `autoBackup` BOOLEAN NOT NULL DEFAULT true,
    `backupHourUtc` INTEGER NOT NULL DEFAULT 18,
    `keepBackups` INTEGER NOT NULL DEFAULT 14,
    `saveExports` BOOLEAN NOT NULL DEFAULT true,
    `lastBackupAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `connectedById` INTEGER NULL,
    `connectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drive_uploads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(10) NOT NULL,
    `fileName` VARCHAR(200) NOT NULL,
    `driveFileId` VARCHAR(100) NULL,
    `sizeBytes` BIGINT NULL,
    `status` VARCHAR(10) NOT NULL,
    `error` VARCHAR(500) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `drive_uploads_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
