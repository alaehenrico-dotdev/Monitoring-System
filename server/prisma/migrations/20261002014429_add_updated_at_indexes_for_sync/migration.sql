-- CreateIndex
CREATE INDEX `daily_offline_stock_updatedAt_idx` ON `daily_offline_stock`(`updatedAt`);

-- CreateIndex
CREATE INDEX `daily_online_stock_updatedAt_idx` ON `daily_online_stock`(`updatedAt`);

-- CreateIndex
CREATE INDEX `manual_counts_updatedAt_idx` ON `manual_counts`(`updatedAt`);

-- CreateIndex
CREATE INDEX `products_updatedAt_idx` ON `products`(`updatedAt`);
