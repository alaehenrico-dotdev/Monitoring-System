-- Variance is now Manual Count - System Remaining Stock (it was System - Manual).
-- Negate every stored figure so existing counts read the same way as new ones.
UPDATE `manual_counts` SET `variance` = -`variance` WHERE `variance` <> 0;
