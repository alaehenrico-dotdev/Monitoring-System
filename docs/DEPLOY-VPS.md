# Deploying to a VPS (Ubuntu 24.04, Nginx, PM2, MySQL on the host)

This is the part of the general "VPS Setup & Deployment Guide" that is specific to this app. It assumes
the server basics from that guide are already done: a non-root user, the firewall (22, 80, 443 only),
and MySQL installed. Where a step is the same as in that guide it says so instead of repeating it.

**How it fits together**

```
Browser -> https://stocks.yourdomain.com
        -> Nginx :443   serves client/dist, and proxies /api, /health, /ws
        -> API (PM2)    127.0.0.1:4000, never public
        -> MySQL        127.0.0.1:3306, never public
```

The app is two parts built from one repo: the API (`server/`, Node + TypeScript + Prisma) and the
client (`client/`, React, built to static files). Nginx replaces the Caddy that the Docker setup uses.

| | |
|---|---|
| Site registry row (guide section 18) | `stocks.yourdomain.com` / Node + React / `/var/www/ala-eh` / port `4000` / nginx file `ala-eh` / database `ala_eh_stocks` |
| Node version | 20 or 22 (the app is tested on both). Use 22. |
| Not needed from the guide | Python, PHP, Composer, importing a schema file (this app creates its tables with migrations) |

---

## 0. Check the tools (about 1 minute)

```bash
node -v            # v20.x or v22.x
npm -v
pm2 -v
nginx -v
git --version
mysql --version
mysqldump --version     # the app and the backup scripts need this
certbot --version
```

Install whatever is missing:

```bash
# Node 22 (the guide's setup_lts.x installs whichever LTS is newest; pin 22 so it matches what was tested)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

sudo apt install -y nginx git certbot python3-certbot-nginx
sudo apt install -y mysql-client      # only if mysqldump was missing
```

## 1. The database

You installed MySQL yesterday. Check what already exists, then create what is missing:

```bash
sudo mysql -e "SHOW DATABASES; SELECT user, host FROM mysql.user;"
```

If there is no database and user for this app yet:

```bash
openssl rand -hex 16        # prints a password with only letters and digits: copy it
sudo mysql
```
```sql
CREATE DATABASE ala_eh_stocks;
CREATE USER 'alaeh_app'@'localhost' IDENTIFIED BY 'PASTE_THE_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON ala_eh_stocks.* TO 'alaeh_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**Do not import a schema.** Unlike the guide's generic example, this app builds its own tables in step 6.

[CHECK] The login works over TCP, which is how the app connects:

```bash
mysql -h 127.0.0.1 -u alaeh_app -p ala_eh_stocks -e "SELECT 1;"
```

If you used other names yesterday, use them in `DATABASE_URL` below.

## 2. Domain and DNS (guide section 3)

Add an `A` record: name `stocks` -> your server IP. Wait until `nslookup stocks.yourdomain.com` returns the
IP. Do not run Certbot (step 9) before it does.

## 3. Get the code (guide section 6)

```bash
sudo mkdir -p /var/www/ala-eh
sudo chown -R $USER:$USER /var/www/ala-eh
git clone https://github.com/YOURNAME/YOURREPO.git /var/www/ala-eh
cd /var/www/ala-eh
```

For a private repo, use the deploy key method from the guide.

## 4. A folder for backups

```bash
sudo mkdir -p /var/backups/ala-eh
sudo chown $USER:$USER /var/backups/ala-eh
chmod 700 /var/backups/ala-eh
```

The backup script and the pre-update snapshots write here.

## 5. The settings file (`server/.env`)

```bash
cd /var/www/ala-eh
cp server/.env.example server/.env
nano server/.env
```

Set these (generate the secrets on the server, never reuse ones from your PC):

```bash
openssl rand -base64 32      # use for JWT_SECRET
openssl rand -base64 32      # use for BACKUP_ENCRYPTION_KEY
```

| Variable | Value |
|---|---|
| `DATABASE_URL` | `"mysql://alaeh_app:THE_PASSWORD@127.0.0.1:3306/ala_eh_stocks?connection_limit=10&pool_timeout=20"` |
| `JWT_SECRET` | the first generated value (32+ characters; the server refuses to start otherwise) |
| `DATA_RESET_PASSCODE` | a short code only admins know (4+ characters, nothing obvious). It guards Data Reset and Restore. |
| `CLIENT_ORIGIN` | `https://stocks.yourdomain.com` exactly as typed in the browser, no trailing slash |
| `HOST` / `PORT` | `127.0.0.1` / `4000` (the example file already has these) |
| `TRUST_PROXY` | leave it unset: the default `loopback` is right, because Nginx runs on this same machine |
| `BACKUP_DIR` | `/var/backups/ala-eh/daily` (the Backups page lists the files it finds here) |
| `BACKUP_ENCRYPTION_KEY` | the second generated value. **Copy it somewhere off the server** (password manager): without it your encrypted backups cannot be opened. |

If the password has symbols in it, they must be percent-encoded inside `DATABASE_URL`; a password from
`openssl rand -hex 16` has none, which is why step 1 uses it.

```bash
chmod 600 server/.env
git status          # server/.env must NOT be listed
```

When a later `git pull` adds variables to `.env.example`, add them to this file by hand (guide section 9).

## 6. Install, build, create the tables, create the first admin

```bash
cd /var/www/ala-eh
npm ci                        # installs everything, including the build tools
npm run build                 # API -> server/dist, client -> client/dist
npm run db:migrate:deploy     # checks migrations, takes a snapshot, creates/updates the tables
```

[CHECK] The last line says `All migrations have been successfully applied`, and:

```bash
mysql -h 127.0.0.1 -u alaeh_app -p ala_eh_stocks -e "SHOW TABLES;"      # 29 tables
```

Now create the first accounts. Pick the admin password yourself, or leave the variable out and the seed
prints random passwords once:

```bash
SEED_ADMIN_PASSWORD='a-long-passphrase-you-choose' npm run seed
```

The seed also loads the product list. Whatever the passwords are, every seeded account must choose its own
at its first sign-in. (If you are going to restore your data from another machine in step 12, you still
seed first: it gives you an admin to sign in with.)

## 7. Run the API with PM2 (guide section 7C)

Always as your normal user, from the repo root:

```bash
cd /var/www/ala-eh
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup          # prints one command starting with "sudo env PATH=...": copy and run it
pm2 install pm2-logrotate
```

[CHECK]

```bash
pm2 status                                        # ala-eh-api: online
curl -fsS http://127.0.0.1:4000/health/live       # {"status":"ok"}
sudo ss -tulpn | grep 4000                        # must show 127.0.0.1:4000, never 0.0.0.0
```

If it is not online, `pm2 logs ala-eh-api --lines 50` says why. A missing or too-short setting is named in
the message.

## 8. Nginx (guide section 7)

The ready-made config is in the repo. **Copy it, do not symlink it**: Certbot edits the file in
`sites-available`, and that edit must not land in your git checkout.

```bash
sudo cp /var/www/ala-eh/deploy/nginx/ala-eh.conf /etc/nginx/sites-available/ala-eh
sudo nano /etc/nginx/sites-available/ala-eh        # change server_name to stocks.yourdomain.com
sudo ln -s /etc/nginx/sites-available/ala-eh /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

If you cloned somewhere other than `/var/www/ala-eh`, change that path everywhere in the file. The security
headers and proxy settings live in two small files next to it (`ala-eh-security.conf`, `ala-eh-proxy.conf`)
that the config includes straight from the repo, so a `git pull` updates them; after one that changes them
run `sudo nginx -t && sudo systemctl reload nginx`.

What the config does, so you know why it is shaped this way:

- serves `client/dist`, with hashed files under `/assets` cached for a year and pages never cached
- sends any unknown path (for example `/daily-report`) to `index.html`, so a page refresh works
- proxies `/api`, `/health` and `/ws` (the WebSocket that makes screens update live) to the API
- allows backup uploads up to 520 MB with long timeouts, and streams them instead of buffering
- sends the security headers the app relies on (CSP, HSTS, no-sniff, ...)

[CHECK]

```bash
curl -I http://stocks.yourdomain.com/                    # 200
curl -fsS http://stocks.yourdomain.com/health/live       # {"status":"ok"} (goes through Nginx to the API)
```

## 9. HTTPS (guide section 8)

```bash
sudo certbot --nginx -d stocks.yourdomain.com
```

Choose to redirect HTTP to HTTPS. Then:

```bash
sudo certbot renew --dry-run
```

`CLIENT_ORIGIN` in `server/.env` must already be the `https://` address (step 5). If you had to change it:
`pm2 restart ala-eh-api --update-env`.

## 10. First sign-in

Open `https://stocks.yourdomain.com` and sign in as `admin`. You are asked to choose your own password.
Then, under Settings > My Account:

1. turn on **two-step verification** (scan the QR code, keep the recovery codes somewhere safe);
2. create a **second administrator** account, so one forgotten password is never a lockout. (If it ever
   happens anyway: `cd /var/www/ala-eh/server && npm run reset-password -- admin`.)

## 11. Backups

**Daily, automatic** (guide section 14): one cron line. It is encrypted automatically because
`BACKUP_ENCRYPTION_KEY` is in `server/.env`.

```bash
crontab -e
```
```
0 3 * * * RETENTION_DAYS=14 bash /var/www/ala-eh/scripts/backup.sh >> $HOME/ala-eh-backup.log 2>&1
```

Run it once by hand to see it work:

```bash
bash /var/www/ala-eh/scripts/backup.sh
ls -lh /var/backups/ala-eh/daily        # a .sql.gz.enc file
```

It also shows up under Settings > Backup & Restore, where each file can be verified in place.

**Off the server** (a backup next to the database is lost with it). From PowerShell on your laptop:

```powershell
scp yourname@YOUR_SERVER_IP:/var/backups/ala-eh/daily/* .
```

You can also connect Google Drive for a weekly encrypted copy (Settings > Google Drive; see
`docs/GOOGLE_DRIVE.md`). Set `GOOGLE_REDIRECT_URI` in `server/.env` to
`https://stocks.yourdomain.com/api/drive/oauth/callback` and register that same address in Google Cloud.
And use Hostinger's snapshot feature as the whole-server backup.

**Restoring** (the screen is Settings > Backup & Restore and asks for the `DATA_RESET_PASSCODE`; or from the
server, which also works when the app is down):

```bash
pm2 stop ala-eh-api
bash /var/www/ala-eh/scripts/restore.sh --latest --yes          # or --file /path/to/backup.sql.gz.enc
npm run prisma:migrate:deploy --workspace server                 # only needed if the backup is from an older version
pm2 start ala-eh-api
```

`restore.sh` opens encrypted backups itself (it needs the same key in `server/.env`), checks the file is a
complete dump before touching anything, and takes a safety snapshot first.

## 12. Moving your data from the other PC

1. On the other PC, download a backup from Settings > Backup & Restore.
2. On the server, finish steps 1 to 10 (seed first, so you can sign in).
3. Put the **same** `BACKUP_ENCRYPTION_KEY` in the server's `.env` if the file is encrypted, then
   `pm2 restart ala-eh-api --update-env`.
4. Sign in as the seeded admin, open Settings > Backup & Restore > Restore, and upload the file.
5. After the restore the accounts are the ones from your backup, so sign in with those. The seeded admin is gone.

## 13. Updating after a push (guide section 10)

```bash
bash /var/www/ala-eh/deploy/vps/deploy.sh
```

It pulls, installs, builds, **takes a database snapshot and then migrates**, restarts the API and waits for
it to answer. Nginx needs no change for a normal update.

Then check: `.env.example` gained variables? Add them to `server/.env`. Open the site and try the changed feature.

**Rolling back** a bad release: find the last good commit with `git log --oneline -5`, then
`git reset --hard abc1234 && npm ci && npm run build && pm2 restart ala-eh-api`. A rollback does **not**
undo database migrations. If a migration has to be undone, restore the snapshot the deploy took
(`/var/backups/ala-eh/snapshots`, newest first) with `restore.sh` as in step 11.

## 14. Checks and troubleshooting for this app

| Symptom | Likely cause and fix |
|---|---|
| 502 Bad Gateway | The API is not running: `pm2 status`, `pm2 logs ala-eh-api --lines 50`. A bad setting is named in the log. |
| API restarts in a loop | `server/.env` problem (short `JWT_SECRET`, missing `CLIENT_ORIGIN`, wrong `DATABASE_URL`). Fix it, then `pm2 restart ala-eh-api --update-env`. |
| Login says the server cannot be reached / CORS errors | `CLIENT_ORIGIN` does not exactly match the address in the browser (`https`, no trailing slash). |
| Everyone shares one login limit, or one person's typos lock others out | The API sees every visitor as `127.0.0.1`: `TRUST_PROXY` was set to something other than `loopback`, or Nginx lost its `X-Forwarded-For` header. |
| Screens do not update live | The `/ws` block is missing or was edited: it needs the `Upgrade` and `Connection "upgrade"` headers. |
| 404 on a page refresh | The `try_files $uri /index.html` line in `location /` is missing. |
| Restore fails with 413 or a timeout | The `/api/backup/` block was removed or edited (it allows 520 MB and 10 minutes). |
| Backups page lists nothing | `BACKUP_DIR` in `server/.env` must be `/var/backups/ala-eh/daily`, and the cron job must have run once. |
| `mysqldump` not found when backing up | `sudo apt install -y mysql-client`. |
| `npm run build` ends with `Killed` | Out of memory: add the swap file from guide section 14. |
| Deploy script stops at `git pull` | Local changes on the server. `git status`, then discard or commit them; the script never merges. |
| Forgot an admin password and there is no second admin | `cd /var/www/ala-eh/server && npm run reset-password -- <username>` (asks for the new password). If they also lost their phone: `npm run reset-mfa -- <username>`. |

## 15. Go-live checklist

- [ ] `nslookup stocks.yourdomain.com` returns the server IP
- [ ] `server/.env` filled in, `chmod 600`, not shown by `git status`; the encryption key is saved off the server
- [ ] `npm run db:migrate:deploy` and `npm run seed` ran without errors
- [ ] `pm2 status` shows `ala-eh-api` online; `pm2 startup` and `pm2 save` done
- [ ] `sudo ss -tulpn`: only 22, 80, 443 public; the API on `127.0.0.1:4000`; MySQL on `127.0.0.1:3306`
- [ ] `sudo nginx -t` ok, site enabled, Certbot done, `certbot renew --dry-run` passes
- [ ] Signed in over `https://`, chose a new password, two-step on, a second admin created
- [ ] A backup ran by hand, the file exists, a copy is off the server
- [ ] An uptime monitor points at `https://stocks.yourdomain.com/health/live`
