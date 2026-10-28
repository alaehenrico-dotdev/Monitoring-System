# Uncommitted Changes

Compared with the last commit (`96e685c`). Secret values are intentionally not recorded here.

## Tracked files

| File | Change |
|---|---|
| `server/package.json` | Added scripts `seed:docker` and `migrate:docker`, both run via `scripts/with-docker-db.mjs`. |
| `package-lock.json` | `qs` bumped from 6.16.0 to 6.16.2 (transitive dependency). |
| `.env.docker.example` | **Deleted.** Template for the root `.env` (keys: `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `JWT_SECRET`, `DATA_RESET_PASSCODE`, `CLIENT_ORIGIN`, `WEB_PORT`). |
| `server/.env.example` | **Deleted.** Template for `server/.env` (keys: `DATABASE_URL`, `NODE_ENV`, `PORT`, `HOST`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN`, `DATA_RESET_PASSCODE`). |

## New file

`server/scripts/with-docker-db.mjs` runs a command against the Docker MySQL database.

- Reads `DB_PASSWORD` and `DB_HOST_PORT` (default `3308`) from the root `.env`.
- Builds a `DATABASE_URL` for user `alaeh_app` and sets it only for the child process, so `server/.env` and the calling shell are untouched.
- Usage: `node scripts/with-docker-db.mjs <command> [args...]`

## Environment files (gitignored, not tracked)

| File | Purpose | Keys |
|---|---|---|
| `.env` (root) | Docker compose | `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `JWT_SECRET`, `DATA_RESET_PASSCODE`, `CLIENT_ORIGIN` (`http://localhost:8080`), `WEB_PORT` (`8080`) |
| `server/.env` | Local dev | `DATABASE_URL`, `NODE_ENV`, `PORT` (`4000`), `HOST` (`127.0.0.1`), `JWT_SECRET`, `JWT_EXPIRES_IN` (`8h`), `CLIENT_ORIGIN` (`http://localhost:5173`), `DATA_RESET_PASSCODE` |

The two files use different `JWT_SECRET` and `DATA_RESET_PASSCODE` values, so tokens from one environment are not valid in the other.

## Things to check

1. **Both `.env.example` files are deleted.** Without them, new contributors can't see which variables are required. Consider restoring them with placeholder values.
2. **Weak secrets.** `DB_PASSWORD` is guessable, `DB_ROOT_PASSWORD` is only 6 characters, and `server/.env`'s `DATA_RESET_PASSCODE` is short. This matters if port 3308 is reachable beyond localhost.
3. **Separate environments.** Confirm the different secrets between local dev and Docker are intended.
