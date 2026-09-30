-- Delivery (Out) becomes the sum of five slot columns (the grid's expandable Delivery columns).
ALTER TABLE `daily_offline_stock`
    ADD COLUMN `delivery1` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `delivery2` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `delivery3` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `delivery4` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `delivery5` DECIMAL(14, 2) NOT NULL DEFAULT 0;

-- Existing entries only have a total: keep it (in slot 1) so the sum still matches.
UPDATE `daily_offline_stock` SET `delivery1` = `deliveryOut`;
