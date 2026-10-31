# Debug findings

Last updated: 2026-10-31. Scope: the two-role change (Encoder / Admin), forgot-password, and database restore.

## Summary

| ID | Severity | Title | Status |
|---|---|---|---|
| F-01 | High | Seed crashes on re-run when a SKU already exists under another name or category | Fixed (verified) |
| F-02 | High | Database restore replaced user accounts, passwords and MFA with the backup's | Fixed (verified) |
| F-03 | Medium | Weak new password was checked after a reset code was already spent | Fixed (verified) |
| F-04 | Low | Dead role-lock code left behind by the role merge (`lockedLocation`, `ownPage`, per-page checks) | Fixed (verified) |
| F-05 | Low | Authenticator reset adds work only for Encoders with MFA, so response time could hint who has MFA | Accepted risk |
| F-06 | Low | Authenticator lockout is in memory, per API process | Accepted risk |

## F-01 Seed crashes on re-run
- **Evidence:** `P2002 Unique constraint failed on products_sku_key` at `seed.ts` `product.create`.
- **Root cause:** products were looked up by name and category only; a product renamed or moved since the last seed was not found, so the seed tried to create a duplicate SKU.
- **Fix:** look up by SKU first, then name and category (`server/prisma/seed.ts`).
- **Verification:** `npm run seed` completed against the dev database (observed). Type-check passes.

## F-02 Restore overwrote user accounts
- **Root cause:** a dump replaces every table, including `users`.
- **Fix:** `keepUserAccountsAcross` (`server/src/services/userAccounts.service.ts`) snapshots the accounts, runs the restore and migrations, then writes the accounts back in one transaction. Accounts only in the backup are deactivated and renamed if their username is taken.
- **Verification:** 5 unit tests; and against the real dev database a simulated restore that corrupted every user came back with all accounts identical and a stray account deactivated (observed, 2026-10-31).
- **Not covered:** a real `.sql` restore through the UI and `mysql` client was not run in this session. `scripts/restore.sh` is unchanged and still replaces accounts.

## F-03 Weak password checked too late
- **Root cause:** the password rules ran after the code was verified.
- **Fix:** rules run first, for every request, in `resetPasswordWithCode`.
- **Verification:** unit test; API check showed a weak password gives 400 and the same code then works (observed).

## F-04 Dead code after the role merge
- **Fix:** removed the always-null `lockedLocation` and `ownPage` flags and the unused per-role location checks and `authorize` hook.
- **Verification:** type-check, lint, 109 client test files and 87 server test files pass.

## Accepted risks (decision needed from the owner)
- **F-05:** the MFA reset path runs only for Encoders with two-step on. Impact is low because every response is the same message and attempts are rate-limited per IP and username.
- **F-06:** fine for one API process. Move the counter to the database if several processes run.

## Not examined
- Browser screens (tabs, Forgot password page, Awaiting Release) were not clicked through.
- A real file restore and `scripts/restore.sh`.
- `npm run build` for the server could not finish while the dev server held the Prisma engine file; the build type-check and the client build pass.
- Production environment and data.

## Checks run
- API smoke test against the dev server with temporary accounts (55 checks, 0 failed; accounts removed afterwards).
- `npx vitest run` in `server` (932 passed) and `client` (1028 passed, 8 skipped).
- `npx eslint .` (0 errors, 1 old warning in `StockGrid.tsx`), `npm audit --omit=dev` (0 vulnerabilities).
