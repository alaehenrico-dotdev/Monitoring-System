-- CreateIndex
CREATE INDEX `daily_offline_stock_entryDate_shift_idx` ON `daily_offline_stock`(`entryDate`, `shift`);

-- CreateIndex
CREATE INDEX `daily_online_stock_entryDate_shift_idx` ON `daily_online_stock`(`entryDate`, `shift`);

-- CreateIndex
CREATE INDEX `manual_counts_entryDate_idx` ON `manual_counts`(`entryDate`);
