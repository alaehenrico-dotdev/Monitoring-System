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
DATABASE_URL="mysql://alaeh_app:URL_ENCODED_PASSWORD@127.0.0.1:3306/ala_eh_stocks"
JWT_SECRET="REPLACE_WITH_A_UNIQUE_RANDOM_SECRET"
DATA_RESET_PASSCODE="REPLACE_WITH_A_DIFFERENT_RANDOM_SECRET"
JWT_EXPIRES_IN=8h
CLIENT_ORIGIN=https://monitor.example.com
TRUST_PROXY=loopback
```

Keep `server/.env` readable only by the deployment account. Do not use the
seeded demonstration passwords in production.

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

Then create a compressed pre-deploy dump:

```bash
sudo install -d -m 700 /var/backups/ala-eh
sudo bash -o pipefail -c 'mysqldump --defaults-extra-file=/root/.my.cnf --single-transaction --routines --triggers ala_eh_stocks | gzip > "/var/backups/ala-eh/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"'
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
# Take and verify a database backup here.
npm run prisma:migrate:deploy --workspace server
pm2 restart ala-eh-api
sudo nginx -t
sudo systemctl reload nginx
```

The root `npm run db:migrate:deploy` helper also runs the repository's
PowerShell snapshot script and is intended for Windows. On Linux, use the
workspace migration command above after taking the explicit VPS backup.

## Data preservation

The retired desktop offline-sync and updater endpoints are no longer
available. Legacy desktop sync and updater tables remain in the Prisma schema
and database so existing deployments do not lose their historical records.
They are no longer read or written by this application; remove them only in a
separate, backed-up migration after confirming the data is no longer needed.
