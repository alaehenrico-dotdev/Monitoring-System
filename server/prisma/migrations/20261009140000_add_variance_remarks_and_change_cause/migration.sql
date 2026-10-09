-- Why a count differs from the system figure (free text, optional), and which
-- change_log row caused an automatic follow-on change (e.g. a carried-forward
-- opening stock re-derived after a manual count). Both nullable.
ALTER TABLE `manual_counts` ADD COLUMN `remarks` VARCHAR(500) NULL;
ALTER TABLE `change_log` ADD COLUMN `causedById` INTEGER NULL;
