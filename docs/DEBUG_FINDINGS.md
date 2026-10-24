# Backend Debug Findings Report

**Project:** Ala Eh Stocks Monitoring System (Node/Express + Prisma + MySQL API, React client, Docker/Caddy deploy)
**Scope:** server dependencies and supply chain; server HTTP surface (routes, auth, rate limiting, error handling, public endpoints); database access and growth; Docker images and compose; `.gitignore` / `.dockerignore`; dead code; developer tooling.
**Last updated:** 2026-10-24
**Investigator:** Claude
**Progress:** Complete with remaining risks

## Summary

| Severity | Open | In progress | Fixed (not verified) | Fixed (verified) | Accepted risk | Blocked | Not reproducible |
|---|---|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| Medium | 0 | 0 | 1 | 6 | 1 | 0 | 0 |
| Low | 1 | 0 | 0 | 4 | 3 | 0 | 0 |

Eighteen findings: 12 fixed and verified, 1 fixed with a manual follow-up (F-009), 4 accepted with reasons, 1 open decision (F-017). The code itself was already well hardened (no SQL-injection surface, complete route authorization, token versioning, required secrets, allowlisted file paths, no shell in process spawning), so the real gaps were in the layers around it: dependencies, the Docker image contents, ignore files, login brute-force coverage, unbounded anonymous-input storage and the dev server's network exposure. The most important remaining item is F-009: this PC's `server/.env` still connects to MySQL as `root`.

## Scope and coverage

- **Examined:** `server/src` (app, server, config/env, middleware auth/rateLimit/errorHandler/idempotency, all route files, auth/backup/backupVerify/clientError/maintenance/drive services, controllers for auth/users/clientError/backup), Prisma schema and migrations, `docker-compose.yml`, `server/Dockerfile`, `client/Dockerfile`, `deploy/caddy/Caddyfile`, `.gitignore`, `.dockerignore`, `server/.env.example`, `client/vite.config.ts`, `npm audit` for the whole workspace, `knip` for unused code, a secret scan of tracked files.
- **Not examined / not provided:** the production host and its real `.env`; the other PC's environment; the live MySQL server configuration beyond the container defaults; Google Drive OAuth state handling (read only at route level); every controller's individual input schema (zod behavior was checked by compile, test suite and API scan, not schema by schema); load/performance behavior under real traffic; the client for XSS beyond what the CSP covers.
- **Assumptions:** the production deployment is the Docker Compose stack (the README's PM2/VPS path was not exercised); `.env` files are never committed (confirmed: only `*.example` files are tracked).
- **Environment for verification:** local Windows machine, Node v24 for tooling and Node 20 inside the images, MySQL 8.0 in a throwaway Docker network (`aeverify-*`, removed afterwards; the existing `monitoringsystem-*` stack and its data were not touched). Server tests 758 passed, client tests 872 passed (8 skipped), `eslint .` clean, `tsc` clean in both workspaces.

## Findings

Severity: Critical, High, Medium, Low. Status: Open, In progress, Fixed (not verified), Fixed (verified), Accepted risk, Blocked, Not reproducible.

### F-001: `body-parser` denial of service (GHSA-27r3-jxmh-p828)

- **Severity:** High (why: reachable by any client of the API; a request with trailing bytes after a compressed body can tie up the process; Express depends on it).
- **Area:** security / dependency
- **Source:** scanner (`npm audit --omit=dev`)
- **Status:** Fixed (verified)
- **Location:** `package-lock.json` (`body-parser` 1.20.8)

**Reproduction and evidence**
`npm audit --omit=dev` listed `body-parser <1.20.9`, high, "fix available via `npm audit fix`".

**Root cause**
Transitive dependency of `express@4` pinned to a vulnerable patch release in the lockfile.

**Fix**
`npm audit fix --package-lock-only` (non-breaking: 1.20.8 -> 1.20.9), then `npm install --ignore-scripts` to bring `node_modules` in line. (A plain `npm audit fix` failed with `EPERM` because the running dev server holds the Prisma engine DLL; the lockfile-only route avoids that.)

**Verification**
- Command run: `node -e "console.log(require('./node_modules/body-parser/package.json').version)"` and, inside the rebuilt API image, `node -e "console.log(require('body-parser/package.json').version)"`
- Result: `1.20.9` locally and in the image; `npm audit --omit=dev` no longer lists it.
- Regression test: existing API/controller suites (server: 758 passed).
- Date verified: 2026-10-24

**Remaining risk**
None identified for this advisory.

### F-002: `ip-address` quadratic-time parsing (GHSA-rxp7-6hxx-x8q5)

- **Severity:** Medium (why: moderate per advisory; a very long string can stall the process; reached through the rate limiter's IPv6 handling).
- **Area:** security / dependency
- **Source:** scanner
- **Status:** Fixed (verified)
- **Location:** `package-lock.json` (`ip-address` 10.7.2)

**Reproduction and evidence**
`npm audit --omit=dev`: `ip-address <=10.7.3`, moderate, fix available.

**Root cause**
Transitive dependency (via `express-rate-limit`) pinned below the patched release.

**Fix**
Same non-breaking lockfile update as F-001 (10.7.2 -> 10.7.4).

**Verification**
- Command run: `node -e "console.log(require('./node_modules/ip-address/package.json').version)"`
- Result: `10.7.4`; `npm audit --omit=dev` no longer lists it; `rateLimit.test.ts` 9 passed.
- Date verified: 2026-10-24

**Remaining risk**
None identified.

### F-003: `zod` memory exhaustion on oversized constrained collections (GHSA-mrhx-c7xc-m3w5)

- **Severity:** High (why: runtime dependency that validates every request body; advisory covers all zod 3.x, no 3.x fix exists).
- **Area:** security / dependency
- **Source:** scanner
- **Status:** Fixed (verified)
- **Location:** `server/package.json` (`zod ^3.23.8`), 23 server files import it

**Reproduction and evidence**
`npm audit --omit=dev`: `zod <4.6.6`, high, fix only via the major upgrade to 4.6.7.

**Root cause**
Library defect; no patched 3.x line.

**Fix**
Upgraded to `zod@^4.6.7`. Scanned the schemas for APIs whose behavior changed in v4: the code uses `flatten()`, `issues[0].message`, `z.coerce.*`, `.default()`, `nativeEnum`, `.strict()`, `.refine()/.transform()` (all still supported); no `z.record`, `required_error`, `ZodIssueCode` or other removed APIs.

**Verification**
- Command run: `cd server && npx tsc --noEmit -p . && npx vitest run`
- Result: tsc clean; 751 tests passed on zod 4.6.7 before this session's additions, 758 after. API image built and ran with zod 4.6.7 (`/health` 200, unauthenticated `/api/products` 401).
- Regression test: existing controller/service suites (they assert 400 responses and messages).
- Date verified: 2026-10-24

**Remaining risk**
Default (non-custom) validation messages are worded differently in v4 ("Invalid input: expected ..." instead of "Required"). Messages the code customizes are unchanged; only fallback wording differs.

### F-004: Production API image shipped dev tooling with known critical/high advisories

- **Severity:** Medium (why: vitest/vite/esbuild/tinypool were present inside the network-facing container; they are not run there, but they enlarge the attack surface and carry two critical advisories).
- **Area:** configuration / security
- **Source:** code review (Dockerfile) plus `npm audit`
- **Status:** Fixed (verified)
- **Location:** `server/Dockerfile` (final stage copied the build stage's full `node_modules`)

**Reproduction and evidence**
The final stage did `COPY --from=build /app/node_modules`, and the build stage's `npm ci` installs devDependencies. In the old image `vitest`, `vite`, `esbuild`, `tinypool` and `typescript` were all present; the image was 1.06 GB.

**Root cause**
No production-only install: build and runtime shared one dependency tree.

**Fix**
Added a `prod-deps` stage (`npm ci --omit=dev`) whose `node_modules` the runtime image copies instead. `prisma` moved from `devDependencies` to `dependencies` because the container runs `prisma migrate deploy` at start (and its postinstall generates the client in that stage).

**Verification**
- Command run: `docker build -f server/Dockerfile -t aeverify-api:test .` then `docker run --rm --entrypoint sh aeverify-api:test -c '... check each package ...'`
- Result: `vitest`, `vite`, `esbuild`, `tinypool`, `tsx` absent; Prisma CLI 6.19.3 and client load; process runs as `uid=1000(node)`; image 937 MB (down from 1.06 GB); all 41 migrations applied on an empty MySQL by the container's own start script and `/health` returned `{"status":"ok","database":"ok"}`.
- Regression test: manual (isolated Docker run, 2026-10-24); not part of the automated suite.
- Date verified: 2026-10-24

**Remaining risk**
`typescript` is still present in the image: it is an optional peer of `prisma` and `@prisma/client` that npm installs in the production tree (the lockfile marks it as not dev-only). It has no open advisory, and I did not try to exclude it.

### F-005: `.dockerignore` excluded only `.env` and `.env.local`

- **Severity:** Medium (why: a real `.env.production` or `.env.docker` anywhere in the tree would be copied into an image layer by `COPY client client`; layers can be pushed or shared).
- **Area:** security / configuration
- **Source:** code review
- **Status:** Fixed (verified)
- **Location:** `.dockerignore`

**Reproduction and evidence**
The file listed `**/.env` and `**/.env.local` only. `.gitignore` already blocked `.env.*`, so git was safe but the Docker build context was not.

**Root cause**
The two ignore files drifted apart.

**Fix**
Rewrote `.dockerignore`: all `.env.*` except the committed `*.example` templates, keys and certificates, Google credential JSON, database dumps and backups, editor and cache folders.

**Verification**
- Command run: planted six fake env files (`.env.production`, `client/.env.production`, `server/.env.staging`, `server/prisma/.env.docker`, `.env.local`, `client/.env.development.local`), then `docker build` of a probe Dockerfile that runs `COPY . /ctx` and lists `find /ctx -name ".env*"`.
- Result: only `.env.docker.example`, `client/.env.example`, `server/.env.example` reached the context; all six planted files and the real `.env` files were excluded. Planted files deleted afterwards.
- Regression test: manual check, 2026-10-24.
- Date verified: 2026-10-24

**Remaining risk**
None identified.

### F-006: Login throttling did not cover password spraying from one address

- **Severity:** Medium (why: `authLimiter` is keyed by IP and username, so every new username starts a fresh bucket; one address could try a password against every account and only the global 600-per-5-minutes limiter would notice).
- **Area:** security / API
- **Source:** code review
- **Status:** Fixed (verified)
- **Location:** `server/src/middleware/rateLimit.ts`, `server/src/routes/auth.routes.ts`

**Reproduction and evidence**
Read `authLimiter.keyGenerator` (`ip:username`). Before the fix there was no bucket that spans usernames.

**Root cause**
The per-account design (so one hammered account cannot lock out an office) left no per-address ceiling.

**Fix**
Added `loginIpLimiter`: keyed by IP only, counts only failed attempts (`skipSuccessfulRequests`), default 50 per 15 minutes (`RATE_LIMIT_LOGIN_IP_MAX`), placed before `authLimiter` on `POST /auth/login`. Offices behind one address signing in normally are never counted.

**Verification**
- Command run: `cd server && npx vitest run src/middleware/rateLimit`, and a live test against the rebuilt stack: 55 login attempts with 55 different usernames through the Caddy proxy.
- Result: unit test (9 passed) covers successes not counting, three usernames sharing one bucket and the window reset. Live: the first 50 attempts returned 401, attempts 51-55 returned 429 with the new message, and a further new username was also blocked.
- Regression test: `rateLimit.test.ts` > "loginIpLimiter - failed logins per IP, across usernames".
- Date verified: 2026-10-24

**Remaining risk**
A distributed attack from many addresses is still limited only per account (10 per 15 minutes) and by the global limiter.

### F-007: `client_errors` table grew without bound from anonymous input

- **Severity:** Medium (why: `POST /api/client-errors` is unauthenticated by design; at 20 per minute per IP and up to ~9 KB per row, one address can add hundreds of MB per day and nothing ever deleted rows).
- **Area:** database
- **Source:** code review
- **Status:** Fixed (verified)
- **Location:** `server/src/services/clientError.service.ts`, `server/src/services/maintenance.service.ts`, `server/src/config/env.ts`

**Reproduction and evidence**
Maintenance only purged idempotency keys and archived the change log; `grep` showed no deletion path for `clientError`.

**Root cause**
Retention was never defined for this table.

**Fix**
`purgeClientErrors` in the nightly maintenance job: deletes reports older than `CLIENT_ERROR_RETENTION_DAYS` (default 90) and keeps at most `CLIENT_ERROR_MAX_ROWS` (default 20,000), oldest first; 0 turns either off.

**Verification**
- Command run: unit tests plus, inside the running API container against a real MySQL, the compiled `purgeClientErrors` on seeded data (5 rows 120 days old, 12 recent).
- Result: age purge removed 5 (left 12); cap purge (max 10) removed 2 (left 10); the ids left were the newest ten (8-17); a second run removed 0. Unit tests 6 passed.
- Regression test: `server/src/services/clientError.service.test.ts`.
- Date verified: 2026-10-24

**Remaining risk**
Other append-only tables (`system_log_entries`, `drive_uploads`, `backup_records`) have no retention; they are small and written only by authenticated flows, so left as they are.

### F-008: Vite dev server and preview listened on every network interface

- **Severity:** Medium (why: `npm run dev` exposed the dev server, and the API it proxies, to the whole LAN; this Vite version has open dev-server advisories (file read, cross-site requests) whose fix needs a major upgrade).
- **Area:** configuration / security
- **Source:** code review plus `npm audit`
- **Status:** Fixed (verified)
- **Location:** `client/vite.config.ts` (`server.host`, `preview.host` were `true`)

**Reproduction and evidence**
Dev server output listed `Network:` URLs for the LAN adapters; `netstat` showed `0.0.0.0:5173`.

**Root cause**
`host: true` set for convenience.

**Fix**
Default `localhost`; `VITE_DEV_LAN=true` (environment or `client/.env.local`) restores LAN access deliberately. Documented in `client/.env.example`.

**Verification**
- Command run: `netstat -ano | grep ":<port>"` for a dev server started with and without the flag.
- Result: default listens on `[::1]` only; with `VITE_DEV_LAN=true` it listens on `0.0.0.0` and `[::]`. The running dev server restarted itself on the config change and now listens on `[::1]:5173`.
- Regression test: manual check, 2026-10-24.
- Date verified: 2026-10-24

**Remaining risk**
Anyone who opts in with `VITE_DEV_LAN=true` is exposed again; see F-015.

### F-009: App guidance and this PC's configuration connect to MySQL as `root`

- **Severity:** Medium (why: a root connection lets a compromised app, or any future injected query, read and change every database on the server and create users; an app-scoped account limits that to one database).
- **Area:** database / security
- **Source:** code review
- **Status:** Fixed (not verified)
- **Location:** `server/.env.example` (`mysql://root:...`), `README.md` setup section, and this PC's `server/.env`

**Reproduction and evidence**
`server/.env.example` and the README example both used `root`; this PC's `server/.env` (value redacted) also connects as `root`. Docker Compose already uses a limited `alaeh_app` account.

**Root cause**
Local-setup documentation took the shortest path.

**Fix**
Example and README now create and use a dedicated account: `GRANT ALL PRIVILEGES ON ala_eh_stocks.* TO 'alaeh_app'@'localhost'`, which covers migrations (`prisma migrate deploy`) and backups (`mysqldump`) for that database only. Verified in the isolated run that the limited account can run all migrations and take the pre-migration snapshot.

**Verification**
- Command run: isolated stack (`MYSQL_USER=alaeh_app`, `MYSQL_PASSWORD=...`) started the API, applied all migrations and wrote `/backups/premigrate_*.sql.gz`.
- Result: pass for the account model. This PC's own `.env` was not changed (it is a secrets file), so the fix is not applied locally.
- Regression test: n/a (documentation and configuration).
- Date verified: 2026-10-24 (account model only)

**Remaining risk**
This PC and any other machine whose `.env` uses `root` keep that exposure until the account is switched. Next action in "Next actions" below.

### F-010: Containers kept default Linux capabilities and could gain privileges

- **Severity:** Low (why: defense in depth; the API already runs as the `node` user).
- **Area:** configuration / security
- **Source:** code review
- **Status:** Fixed (verified)
- **Location:** `docker-compose.yml`

**Reproduction and evidence**
No `cap_drop` or `security_opt` on any service.

**Root cause**
Defaults never tightened.

**Fix**
`no-new-privileges` on all three services; `cap_drop: ALL` on the API and web services (web keeps only `NET_BIND_SERVICE`); MySQL started with `--local-infile=0`.

**Verification**
- Command run: ran the API (`--cap-drop ALL --security-opt no-new-privileges:true`), Caddy (`--cap-drop ALL --cap-add NET_BIND_SERVICE`) and MySQL (`--security-opt no-new-privileges:true --local-infile=0`) with the same flags in an isolated network; `docker compose config -q` for the compose file.
- Result: all three ran normally; `SELECT @@local_infile` returned `0`; the API applied 41 migrations and served `/health`; Caddy served the client and proxied `/health` and `/api` (401 without a token) with the security headers intact.
- Regression test: manual check, 2026-10-24. The compose file itself was validated but the real stack was not recreated (your stack is still running on the old settings until you run `docker compose up -d`).
- Date verified: 2026-10-24

**Remaining risk**
`read_only` root filesystems were not attempted (Prisma and mysqldump write temp files); left as a later hardening step.

### F-011: `.gitignore` gaps for credentials, dumps and profiles

- **Severity:** Low (why: no leak found; this closes holes that could cause one).
- **Area:** configuration
- **Source:** user request plus code review
- **Status:** Fixed (verified)
- **Location:** `.gitignore`

**Reproduction and evidence**
Secret scan of tracked files found nothing real (only the placeholder `GOCSPX-...` in a doc). The file lacked: SSH/GPG/Java key formats, `.netrc`/`.htpasswd`/`.aws/`, compressed SQL dump variants (`.sql.zip/.bz2/.xz/.zst/.7z`), embedded database files, `uploads/`, Node heap/CPU profiles (which can contain secrets from memory) and crash dumps.

**Root cause**
Rules were added as needs arose.

**Fix**
Added those patterns, grouped and commented, and per-user compose overrides (`docker-compose.*.override.yml`).

**Verification**
- Command run: `git ls-files -ci --exclude-standard` and `git check-ignore -v` on sample names.
- Result: no tracked file is newly ignored; `.env.docker.example`, `server/.env.example`, migrations and the poster logo remain visible; `foo.sqlite`, `id_rsa`, `.aws/credentials`, `uploads/x`, `core.1234` are ignored; `server/.env` still ignored.
- Regression test: manual check, 2026-10-24.
- Date verified: 2026-10-24

**Remaining risk**
`*.db` and `report.*.json` are new broad patterns; a legitimate file with those names would need an exception (none exists today).

### F-012: Dead code

- **Severity:** Low
- **Area:** code
- **Source:** user request plus `knip`
- **Status:** Fixed (verified)
- **Location:** see Fix

**Reproduction and evidence**
`knip` listed 40 unused exports and 78 unused exported types. Cross-checking every name against the whole repo (production and tests) left nine symbols referenced nowhere, plus one unused dependency. Exports used only inside their own file, and exported types (inferred elsewhere), were left alone: they are not dead code.

**Root cause**
Features and test seams that were never used or were replaced.

**Fix**
Removed `getAwaitingSummary` (client API), `SkeletonText`, `SkeletonCircle`, `PinIcon`, `MapPinIcon` (and their two icon imports), `clearQuickJump`, `archiveStats` (server), `periodRank` (server) and the unused `@testing-library/user-event` dev dependency. `clearQuickJumpProductCache` was not deleted: it was documented as "called after a Data Reset" but nothing called it (see F-013). Not removed on purpose: the `sync_push_applications` table, which the schema documents as retained deliberately.

**Verification**
- Command run: `npx eslint .`, `tsc --noEmit` in both workspaces, both test suites.
- Result: eslint exit 0; tsc clean; server 758 and client 872 tests passed.
- Regression test: the full suites.
- Date verified: 2026-10-24

**Remaining risk**
`GET /pending-releases/summary` is still served by the API though the client no longer calls it; left because other consumers cannot be ruled out.

### F-013: Quick-jump (Ctrl+K) product list was never refreshed

- **Severity:** Low (why: the palette showed stale products after a SKU was added, renamed or switched off, or after a data reset, until the page was reloaded).
- **Area:** code (client)
- **Source:** code review while removing dead code
- **Status:** Fixed (verified)
- **Location:** `client/src/components/QuickJump.tsx`, `client/src/api/products.ts`, `client/src/pages/DataResetPage.tsx`

**Reproduction and evidence**
The cache is module-level for the whole session; its only invalidator (`clearQuickJumpProductCache`) had no callers.

**Root cause**
The reset hook described in the comment was never wired up, and product mutations never invalidated the cache.

**Fix**
Product mutations (`create`, `update`, `deactivate`, `delete`, `reorder`, `sync`) now announce a change on success; the palette listens and refetches; the Data Reset page announces after a reset.

**Verification**
- Command run: `cd client && npx vitest run src/api/products src/components/QuickJump`
- Result: 10 passed (event fires once per successful mutation, not on failure; the palette refetches after a change and retries after a failed load).
- Regression test: `client/src/api/products.test.ts`, `client/src/components/QuickJump.cache.test.tsx`.
- Date verified: 2026-10-24

**Remaining risk**
Changes made by another user's browser session are not pushed to this one; the palette refreshes on this browser's own mutations only.

### F-014: Prisma CLI dependency chain advisory (`deepmerge-ts`, via `@prisma/config`)

- **Severity:** Low (scanner says High; why Low: stack exhaustion while merging recursive object graphs inside the Prisma CLI's config loader; no request data reaches it; in the container the CLI only runs `migrate status/deploy`).
- **Area:** security / dependency
- **Source:** scanner
- **Status:** Accepted risk
- **Location:** `prisma@6.19.3` -> `@prisma/config` -> `deepmerge-ts`

**Reproduction and evidence**
`npm audit --omit=dev`: 3 high (prisma, @prisma/config, deepmerge-ts); fix only by the Prisma 6 -> 7 major upgrade.

**Root cause**
Library defect fixed only in a major release.

**Fix**
None now (see Decision).

**Verification**
Not applicable (risk accepted, not fixed).

**Remaining risk**
Moving `prisma` to `dependencies` (F-004) means the CLI now ships in the image, so `npm audit --omit=dev` now reports it. Decision: Accept until Prisma 7 can be adopted as its own migration (driver adapters change the client setup).

### F-015: Development tooling advisories (vitest/tinypool critical, vite/esbuild high-moderate)

- **Severity:** Medium (scanner says Critical; why Medium: dev-only, never in the production images after F-004, reachable only on a developer machine while tools run; the dev server is localhost-only by default after F-008).
- **Area:** security / dependency
- **Source:** scanner
- **Status:** Accepted risk
- **Location:** `client` and `server` devDependencies (`vitest@3`, `vite@5`)

**Reproduction and evidence**
`npm audit`: 8 vulnerabilities in the full tree (2 critical: vitest/@vitest/mocker and tinypool; vite, esbuild, vitest mocker). Fixes need vitest 5 and vite 8, both major.

**Root cause**
Dev tools lag the advisory fixes; majors required.

**Fix**
Mitigated, not fixed: F-004 keeps these packages out of production images; F-008 stops the dev server listening on the LAN by default.

**Verification**
Not applicable.

**Remaining risk**
Running `npm test`/`npm run dev` on a machine that processes untrusted files or visits hostile pages while the dev server is up. Decision: Defer the vitest/vite major upgrades to a planned tooling upgrade.

### F-016: bcrypt work factor is 10

- **Severity:** Low (OWASP minimum; bcryptjs is slower than native).
- **Area:** security
- **Source:** code review
- **Status:** Accepted risk
- **Location:** `server/src/services/users.service.ts`, `server/src/services/auth.service.ts` (`DUMMY_HASH`)

**Reproduction and evidence**
Hashes use cost 10; `auth.service.ts` compares unknown usernames against a dummy hash of the same cost so response timing does not reveal which usernames exist.

**Root cause**
Not a defect.

**Fix**
Deliberately not changed. Raising the cost for new passwords only would make existing (cost 10) and new (cost 12) accounts differ in login time and break the dummy-hash timing parity; a safe change needs rehash-on-login plus a matching dummy cost, which is a separate piece of work.

**Verification**
Not applicable.

**Remaining risk**
Offline cracking of a leaked hash table is somewhat cheaper than at cost 12. Decision: Accept; revisit with rehash-on-login.

### F-017: Node `requestTimeout` (default 5 minutes) is shorter than the restore upload allowance

- **Severity:** Low (why: only slow, very large restore uploads could be cut off; no data is lost, the restore simply fails).
- **Area:** configuration / API
- **Source:** code review
- **Status:** Open
- **Location:** `server/src/server.ts` (no explicit timeouts), `deploy/caddy/Caddyfile` (`read_timeout 600s`, `max_size 520MB`)

**Reproduction and evidence**
Caddy allows a 10-minute upload of up to 520 MB, while Node 20's HTTP server defaults `requestTimeout` to 300 seconds. Not reproduced (needs a slow upload); this comes from reading the two configurations against Node's documented defaults.

**Root cause (suspected)**
The proxy and the API disagree about how long a restore upload may take.

**Fix**
Not applied: raising `requestTimeout` for the whole server weakens slow-request protection on every route. A safe fix scopes the longer timeout to the restore route.

**Verification**
Not verified.

**Remaining risk**
A restore of a large backup over a slow link may fail at 5 minutes. Decision needed from the owner: scope a longer timeout to `/api/backup/restore`, or accept.

### F-018: MySQL root is reachable from the host on `127.0.0.1:3308`

- **Severity:** Low (why: loopback only, root password required; present for MySQL Workbench access).
- **Area:** database / configuration
- **Source:** code review
- **Status:** Accepted risk
- **Location:** `docker-compose.yml` (`db.ports`, no `MYSQL_ROOT_HOST`)

**Reproduction and evidence**
The compose comment says the port exists for Workbench; the `root` account host defaults to `%`.

**Root cause**
Convenience for administration.

**Fix**
Not changed: restricting root to `localhost` (`MYSQL_ROOT_HOST`) takes effect only on a new data volume and would stop Workbench connecting as root.

**Verification**
Not applicable.

**Remaining risk**
Any local process on the host that knows the root password can use it. Decision: Accept; use `alaeh_app` for Workbench if root access is not needed.

## Remaining risks

| ID | Risk | Severity | Owner | Decision | Deadline |
|---|---|---|---|---|---|
| F-009 | This PC's (and any other machine's) `.env` still connects to MySQL as `root` | Medium | Project owner | Mitigate: create `alaeh_app` and switch `DATABASE_URL` | Next maintenance window |
| F-015 | Dev-tool advisories need vitest 5 / vite 8 major upgrades | Medium | Project owner | Defer to a planned tooling upgrade | Next quarter |
| F-017 | Large slow restore uploads can hit Node's 5-minute `requestTimeout` | Low | Project owner | Decide: scope a longer timeout to the restore route | Before relying on large remote restores |
| F-014 | Prisma CLI chain advisory (needs Prisma 7) | Low | Project owner | Accept; adopt Prisma 7 as its own migration | When Prisma 7 is scheduled |
| F-016 | bcrypt cost 10 | Low | Project owner | Accept; revisit with rehash-on-login | n/a |
| F-018 | MySQL root reachable on host loopback for Workbench | Low | Project owner | Accept | n/a |

## Evidence still needed

- The production host's `.env` account and `docker compose` settings (to confirm the same hardening applies there).
- A slow-link restore attempt, if large remote restores are expected (F-017).
- The other PC's installed versions after `git pull`, to confirm it builds from the updated lockfile.

## Next actions

1. Create the `alaeh_app` MySQL account on this PC (SQL in the README) and change `server/.env` `DATABASE_URL` to use it, then restart the API (closes F-009 locally).
2. Run `docker compose up -d --build` to recreate the stack with the hardened settings and the slimmer API image (F-004, F-010); a restart of the running containers alone does not apply them.
3. Stop the dev server and run a normal `npm install` once so the Prisma client regenerates against the installed packages (this session installed with `--ignore-scripts` because the running dev server locks the Prisma engine file).
4. Decide F-017 (scope a longer timeout to the restore route, or accept).
5. Plan the Prisma 7 and vitest 5 / vite 8 upgrades (F-014, F-015).

## Change log

| Date | Change |
|---|---|
| 2026-10-24 | Report created. 18 findings recorded; 12 fixed and verified, 1 fixed pending a manual follow-up, 4 accepted, 1 open. |
