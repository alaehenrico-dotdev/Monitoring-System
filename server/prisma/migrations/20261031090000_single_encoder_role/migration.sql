-- Two roles: ENCODER (both entry grids) and SUPERVISOR_ADMIN.
-- Widen the enum first so existing rows stay valid, move them, then narrow it.
ALTER TABLE `users` MODIFY `role` ENUM('ONLINE_ENCODER', 'OFFLINE_ENCODER', 'ENCODER', 'SUPERVISOR_ADMIN') NOT NULL;
UPDATE `users` SET `role` = 'ENCODER' WHERE `role` IN ('ONLINE_ENCODER', 'OFFLINE_ENCODER');
ALTER TABLE `users` MODIFY `role` ENUM('ENCODER', 'SUPERVISOR_ADMIN') NOT NULL;
