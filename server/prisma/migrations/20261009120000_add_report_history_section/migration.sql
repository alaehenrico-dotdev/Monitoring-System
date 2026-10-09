-- Which part of a report was generated: Online, Offline or the full/combined one.
-- NULL on entries made before this column existed (shown as unspecified).
ALTER TABLE `report_history_entries` ADD COLUMN `section` VARCHAR(20) NULL;
