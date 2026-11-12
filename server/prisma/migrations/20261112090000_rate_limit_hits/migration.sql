-- CreateTable
CREATE TABLE `rate_limit_hits` (
    `key` VARCHAR(80) NOT NULL,
    `hits` INTEGER NOT NULL,
    `resetAt` DATETIME(3) NOT NULL,

    INDEX `rate_limit_hits_resetAt_idx`(`resetAt`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
