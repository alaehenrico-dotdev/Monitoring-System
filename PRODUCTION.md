# Hostinger VPS deployment

This project needs a continuously running Node.js API and MySQL-compatible
database. Deploy it to a Hostinger VPS (or another Linux VPS); shared hosting
is not suitable for the API or its realtime WebSocket connection. Nginx serves
the built web client and reverse-proxies API traffic to the private Node
process.

## 1. Prepare the VPS and DNS

Point your domain's `A` record at the VPS IPv4 address (and its `AAAA` record
only if IPv6 is configured). On an Ubuntu VPS, install Git, Node.js 22 LTS,
Nginx, MySQL/MariaDB client tools, and Certbot:

```bash
sudo apt update
sudo apt install -y git nginx default-mysql-client certbot python3-certbot-nginx curl
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

Allow inbound SSH, HTTP, and HTTPS in the Hostinger firewall; do not expose
the API port or MySQL port.

If the GitHub repository is private, add the VPS's SSH public key to that
repository as a read-only deploy key, then clone it:

```bash
git clone git@github.com:OWNER/REPOSITORY.git /var/www/ala-eh
cd /var/www/ala-eh
npm ci
```

Never put a GitHub token, production `.env`, database password, or signing
key in the repository.

## 2. Create and configure the database

Create a dedicated database and application user, for example:

```sql
CREATE DATABASE ala_eh_stocks CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'alaeh_app'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_LONG_PASSWORD';
GRANT ALL PRIVILEGES ON ala_eh_stocks.* TO 'alaeh_app'@'127.0.0.1';
```

Keep MySQL bound to localhost; do not open port 3306 to the Internet. Set
`DATABASE_URL` in `server/.env` to the MySQL connection string. URL-encode
special characters in the username or password.

Create `server/.env` with production values. Generate separate random secrets
for `JWT_SECRET` and `DATA_RESET_PASSCODE`:

```bash
openssl rand -hex 32
```

Example:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
DATABASE_URL="mysql://alaeh_app:URL_ENCODED_PASSWORD@127.0.0.1:3306/ala_eh_stocks?connection_limit=10&pool_timeout=20"
JWT_SECRET="REPLACE_WITH_A_UNIQUE_RANDOM_SECRET"
DATA_RESET_PASSCODE="REPLACE_WITH_A_DIFFERENT_RANDOM_SECRET"
JWT_EXPIRES_IN=8h
CLIENT_ORIGIN=https://monitor.example.com
TRUST_PROXY=loopback
```

The server validates this at boot and refuses to start rather than running
misconfigured:

| Variable | Rule |
| --- | --- |
| `JWT_SECRET` | At least 32 characters, and not a known placeholder. Every token it signs is handed to a client, so a short secret is open to unlimited offline guessing. |
| `DATA_RESET_PASSCODE` | At least 4 characters, and not a known placeholder. Deliberately short-friendly: it is typed into the Data Reset screen, and it is defended by the passcode rate limiter plus a single-use token, not by length. |
| `CLIENT_ORIGIN` | **Required when `NODE_ENV=production`**, with no trailing slash. It is the only browser origin allowed through CORS. Previously it silently defaulted to `http://localhost:5173`, which booted fine and then had the browser reject every request from the real frontend. |
| `TRUST_PROXY` | An address or preset, never a hop count. See `server/.env.example`. |

`connection_limit` on `DATABASE_URL` is worth setting explicitly on a VPS:
Prisma otherwise sizes its pool as (CPUs x 2 + 1) *per process*, and a few
pm2 restarts or a second service on the same MySQL can exhaust
`max_connections` (151 by default).

Keep `server/.env` readable only by the deployment account (`chmod 600`). Do
not use the seeded demonstration passwords in production.

## 3. Back up, migrate, build, and seed

Before a migration or deployment that changes data, take a database backup and
copy it off the VPS. Configure a private MySQL client option file so the
password is not placed on the command line:

```ini
# /root/.my.cnf (chmod 600)
[client]
user=alaeh_app
password=YOUR_DATABASE_PASSWORD
host=127.0.0.1
```

Then create a compressed pre-deploy dump. The repository ships a script that
does this with verification and retention, and works on both Linux and
Windows (`scripts/backup.sh` / `scripts/backup.ps1`, selected automatically):

```bash
sudo install -d -m 700 /var/backups/ala-eh
sudo chown "$USER" /var/backups/ala-eh

# Timestamped, gzipped, and verified before it is kept. Writes to
# $BACKUP_DIR (default /var/backups/ala-eh), reading DATABASE_URL from
# server/.env. Retains 7 days of daily dumps, always keeping the newest.
npm run backup

# Before a schema migration specifically - kept in snapshots/ so the daily
# purge never removes it:
npm run backup:snapshot
```

The script writes to `*.sql.gz.partial` and only renames it into place once
the dump has been verified to carry both the MySQL header and the
`-- Dump completed` trailer, so a dump truncated by a full disk or a dropped
connection can never be mistaken for a good backup or kept by retention.

To restore (this REPLACES the database, and takes its own safety snapshot
of the current data first):

```bash
npm run restore -- --latest --yes
npm run restore -- --file /var/backups/ala-eh/daily/db_backup_....sql.gz --yes
```

The equivalent raw command, if you would rather not use the script:

```bash
sudo bash -o pipefail -c 'mysqldump --defaults-extra-file=/root/.my.cnf --single-transaction --routines --triggers --no-tablespaces ala_eh_stocks | gzip > "/var/backups/ala-eh/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"'
```

Schedule the daily backup with cron (the Windows equivalent is
`scripts/install-backup-task.ps1`):

```cron
# crontab -e, as the user that owns /var/www/ala-eh
# 02:15 daily. Logs to syslog; the script exits non-zero on any failure, so
# cron's MAILTO will surface a broken backup instead of it failing silently.
15 2 * * * cd /var/www/ala-eh && /usr/bin/npm run backup >> /var/log/ala-eh-backup.log 2>&1
```

A backup that is never restored is a guess, not a backup - rehearse a restore
into a scratch database periodically:

```bash
BACKUP_DIR=/var/backups/ala-eh DATABASE_URL="mysql://user:pw@127.0.0.1:3306/ala_eh_restore_test"   npm run restore -- --latest --yes --no-safety-snapshot
```

Install the MySQL client tools on the VPS; the Settings > Backup & Restore
feature also requires `mysqldump` and `mysql` to be available to the API user.
Use encrypted off-site storage for backups and rehearse restores against a
separate test database.

From the repository root, build both applications and apply only committed
Prisma migrations:

```bash
npm run build
npm run prisma:migrate:deploy --workspace server
```

Run `npm run seed --workspace server` only for a new database. It creates
initial records and demonstration accounts; change those passwords or remove
the accounts before opening the site to users.

Build on the VPS or make sure the build machine has no `client/.env.local` or
`client/.env.production` overriding `VITE_API_URL`. The production bundle must
use the default relative `/api` path so it calls this domain through Nginx,
not a developer machine's `localhost`.

## 4. Run the API with PM2

The checked-in PM2 configuration runs only the API on `127.0.0.1:4000`.
Nginx serves `client/dist` directly; do not expose Vite's development or
preview server in production.

```bash
sudo npm install --global pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the exact privileged command printed by `pm2 startup` to configure startup
after a reboot. Useful commands:

```bash
pm2 status
pm2 logs ala-eh-api
pm2 restart ala-eh-api
```

## 5. Configure Nginx and HTTPS

Copy [`deploy/nginx/monitoring.conf.example`](deploy/nginx/monitoring.conf.example)
to the VPS's Nginx sites-enabled directory. Replace `monitor.example.com` with
your domain and confirm the static root matches `/var/www/ala-eh/client/dist`.
The configuration serves the SPA, forwards `/api` and `/health`, and upgrades
`/ws` for realtime updates. It allows database restore uploads slightly above
the server's 512 MiB limit and streams those uploads instead of buffering them
on disk.

Validate and reload Nginx, then issue a TLS certificate with Certbot or
Hostinger's supported certificate flow:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d monitor.example.com
```

Test the public health endpoint after HTTPS is active:

```bash
curl --fail https://monitor.example.com/health
```

It should return `{"status":"ok","database":"ok"}`. `/health/live` checks the
process without requiring the database.

## 6. Deploy updates

Run tests and lint in CI before deployment. On the VPS, take and copy a fresh
backup before applying schema migrations:

```bash
cd /var/www/ala-eh
git pull --ff-only
npm ci
npm run build

# Takes a verified pre-migration snapshot, then migrates - and stops before
# migrating if the snapshot fails.
npm run db:migrate:deploy

pm2 restart ala-eh-api
sudo nginx -t
sudo systemctl reload nginx
```

`npm run db:migrate:deploy` is now cross-platform: `scripts/backup.mjs`
dispatches to `backup.sh` on Linux and `backup.ps1` on Windows, so the same
command is correct on the VPS and on a developer machine. (It previously
invoked PowerShell directly, which made it fail outright on Linux.)

To migrate without the automatic snapshot - only if you have just taken one
by hand:

```bash
npm run prisma:migrate:deploy --workspace server
```

## Data preservation

The retired desktop offline-sync and updater endpoints are no longer
available. Legacy desktop sync and updater tables remain in the Prisma schema
and database so existing deployments do not lose their historical records.
They are no longer read or written by this application; remove them only in a
separate, backed-up migration after confirming the data is no longer needed.
