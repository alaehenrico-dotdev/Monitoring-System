-- A supervisor can revert a published audit: its counts go back to unpublished.
-- The snapshot (Audit History) is kept and marked.

-- AlterTable
ALTER TABLE `audit_snapshots`
    ADD COLUMN `revertedAt` DATETIME(3) NULL,
    ADD COLUMN `revertedById` INTEGER NULL,
    ADD COLUMN `revertReason` VARCHAR(500) NULL;
