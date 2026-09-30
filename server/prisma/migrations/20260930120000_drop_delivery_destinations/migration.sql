-- The per-destination Delivery (Out) breakdown is removed. daily_offline_stock.deliveryOut
-- already holds each entry's total (it was a write-through cache of the breakdown sum),
-- so no totals change - only the per-destination detail is dropped.

-- DropTable
DROP TABLE `offline_entry_deliveries`;

-- DropTable
DROP TABLE `delivery_destinations`;
