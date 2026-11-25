-- The Change Log page lists one table at a time, newest first. Additive: one index, no rows touched.
CREATE INDEX `change_log_tableName_id_idx` ON `change_log`(`tableName`, `id`);
