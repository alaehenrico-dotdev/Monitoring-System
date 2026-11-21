-- Adds the AUDITOR role: counts stock blind on a phone, with no access to the rest of the API.
ALTER TABLE `users` MODIFY `role` ENUM('ENCODER', 'SUPERVISOR_ADMIN', 'AUDITOR') NOT NULL;
