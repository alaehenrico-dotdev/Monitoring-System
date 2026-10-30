-- Every account that exists today signed in with a password chosen before the 10-character
-- rules and (for seeded accounts) one that was printed or handed over by someone else.
-- Each person picks their own at their next sign-in. Accounts created from now on get the
-- flag from the application. (Column added in 20261030090000_account_security.)
UPDATE `users` SET `mustChangePassword` = true;
