-- Finish day locks one entry page (Online or Offline) at a time.
-- Existing rows keep meaning what they did: a closed day had both pages locked,
-- an unlocked one had neither.
ALTER TABLE `day_closures`
    ADD COLUMN `onlineLocked` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `offlineLocked` BOOLEAN NOT NULL DEFAULT true;

UPDATE `day_closures` SET `onlineLocked` = `isClosed`, `offlineLocked` = `isClosed`;
