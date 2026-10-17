# Setting up the system on a new PC

Follow the parts in order. **Part A** gets what you need out of the old PC.
**Part B** installs the tools. **Part C** runs the system in Docker, which is the
way to run it day to day without VS Code. **Part D** (VS Code development) is
optional. **Part E** covers the things that keep it running on its own.

Written for Windows 10/11. Commands are PowerShell unless a block says otherwise.

---

## What moves, and how

| What | Where it lives | How it moves |
|---|---|---|
| Code | this repository | `git clone` (never copy `node_modules`) |
| Data (stock, users, history) | the MySQL database | a `.sql` backup file (Part A) |
| Secrets | `.env` files (git-ignored) | write them down; or generate new ones (see the warning in A3) |

The repository does **not** contain your data or your secrets. If you only clone
the code, you get an empty system.

---

## Part A. On the OLD PC (do this first)

### A1. Take a full database backup
Pick one:
- **In the app:** sign in as admin, **Settings → Backup & Restore → Download Backup**.
  It saves a `.sql` file. The page's history will show it as "Complete".
- **Docker install:** from the project folder:
  ```powershell
  docker compose exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces ala_eh_stocks > /tmp/backup.sql'
  docker compose cp db:/tmp/backup.sql .\ala-eh-backup.sql
  ```

Check the file ends with a line starting `-- Dump completed`. A file without it is
truncated and must not be used. Copy it to a USB drive or a cloud folder.

### A2. Make sure the code is in Git
```powershell
git status          # should say "nothing to commit"
git push
```
Commit and push anything outstanding. The new PC will clone from the remote.

### A3. Write down the secrets
Open the old `.env` (project root, Docker install) or `server\.env` (dev install)
and note: `JWT_SECRET`, `DATA_RESET_PASSCODE`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`,
`CLIENT_ORIGIN`.

> You do **not** have to reuse them. New values on the new PC are fine and safer.
> Changing `JWT_SECRET` signs everyone out once. Changing `DATA_RESET_PASSCODE`
> changes the passcode for Data Reset and Restore. User passwords live in the
> database and come across with the backup.

---

## Part B. On the NEW PC: install the tools (command line)

Everything installs with `winget`, which comes with Windows 10/11. If
`winget --version` is not found, update "App Installer" from the Microsoft Store.

### B1. Install WSL 2 (needed by Docker Desktop)
Open PowerShell **as Administrator**:
```powershell
wsl --install --no-distribution
```
Restart the PC when it finishes.

### B2. Install the tools
Open PowerShell **as Administrator** again:
```powershell
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.VisualStudioCode -e --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
```
Restart the PC (or at least close and reopen PowerShell) so the new commands are on the PATH.

### B3. Install the VS Code extensions
```powershell
code --install-extension ms-azuretools.vscode-docker
code --install-extension Prisma.prisma
code --install-extension dbaeumer.vscode-eslint
```

### B4. Start Docker Desktop and make it start at sign-in
Start it once and wait until it reports it is running (the first start can take a
minute or two):
```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
do { Start-Sleep 5; docker info *> $null } until ($LASTEXITCODE -eq 0)
"Docker is running"
```
Then make it start with Windows (run as the user who will sign in):
```powershell
New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
  -Name "Docker Desktop" -PropertyType String -Force `
  -Value '"C:\Program Files\Docker\Docker\Docker Desktop.exe" -Autostart' | Out-Null
```
The first time Docker Desktop runs it may show a licence agreement window; accept it.

### B5. Check everything
```powershell
git --version
docker --version
docker compose version
node --version
code --version
```
All five must print a version.

---

## Part C. Run the system with Docker

### C1. Get the code
```powershell
cd C:\
git clone <your-repository-url> ala-eh
cd ala-eh
code .          # optional: open it in VS Code
```

### C2. Create the `.env` file
```powershell
Copy-Item .env.docker.example .env
```
Open `.env` and set every value:

| Variable | What to put |
|---|---|
| `DB_PASSWORD` | a new password |
| `DB_ROOT_PASSWORD` | a different new password |
| `JWT_SECRET` | 32 or more random characters (command below) |
| `DATA_RESET_PASSCODE` | a passcode you will remember. Not `000000` or another obvious placeholder: the server refuses those |
| `CLIENT_ORIGIN` | exactly what people type in the browser, with **no trailing slash**. On the same PC: `http://localhost:8080`. For other PCs on the network: `http://<this-PC's-IP>:8080` |
| `WEB_PORT` | `8080`, unless it is taken |

Generate a secret:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
(No Node? Use: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`)

Find this PC's IP: `ipconfig`, then the IPv4 Address of the active adapter.
Give this PC a fixed address (router DHCP reservation) so `CLIENT_ORIGIN` does not break.

> `CLIENT_ORIGIN` must match the browser address exactly. If it doesn't, the
> page loads but every request fails with a CORS error.

### C3. Start it
```powershell
docker compose up -d --build
```
The first build takes several minutes. Then check:
```powershell
docker compose ps                 # db, api, web should all be "running"/"healthy"
docker compose logs api --tail 30 # should end with "API listening on ..."
```
The API applies the database migrations by itself every time it starts.

### C4. Load the data

**Fresh start (no old data):** create the starting products and accounts:
```powershell
docker compose exec api npx tsx prisma/seed.ts
```
It prints a one-time password for `admin`, `online.encoder` and `offline.encoder`.
**Write them down now: they are shown only once.** To choose the admin password
yourself instead:
```powershell
docker compose exec -e SEED_ADMIN_PASSWORD=<your-password> api npx tsx prisma/seed.ts
```

**Moving the old data (the normal case):** restore the backup from Part A.

Option 1, in the app (recommended; it checks the file first):
1. Run the seed above and sign in as `admin`.
2. **Settings → Backup & Restore → Restore**. Enter the `DATA_RESET_PASSCODE`.
3. Choose the `.sql` file. Wait for "Backup file looks complete" (the pre-restore
   check). If it says **Do not restore this file**, stop and take a new backup.
4. Confirm. The page downloads a safety copy of the current data first, then restores.
5. Restart the API so any newer migrations are applied, then sign in with your
   **old** accounts (the restore replaced the users):
   ```powershell
   docker compose restart api
   ```

Option 2, command line:
```powershell
docker compose cp .\ala-eh-backup.sql db:/tmp/restore.sql
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ala_eh_stocks < /tmp/restore.sql'
docker compose restart api
```

### C5. Open it from other devices (and open the firewall)

1. **Find this PC's address** (the one on the office network, not `172.x` or `127.x`):
   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" } | Select-Object IPAddress, InterfaceAlias
   ```
2. **Put that address in `.env`** and apply it (a wrong value gives CORS errors):
   ```
   CLIENT_ORIGIN=http://192.168.1.50:8080
   ```
   ```powershell
   docker compose up -d
   ```
3. **Open the firewall** (PowerShell **as Administrator**):
   ```powershell
   New-NetFirewallRule -DisplayName "Ala Eh system" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private,Domain
   ```
   Make sure this PC's network is **Private**, because the rule above does not apply
   to Public networks:
   ```powershell
   Get-NetConnectionProfile                                   # check NetworkCategory
   Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private   # use the name shown above
   ```
4. **Open it on the other device** (phone, laptop or another PC on the same
   Wi-Fi/LAN): `http://192.168.1.50:8080` (your address from step 1).

Quick tests from the host PC if it does not work:
```powershell
Test-NetConnection 192.168.1.50 -Port 8080     # TcpTestSucceeded should be True
Get-NetFirewallRule -DisplayName "Ala Eh system" | Select-Object DisplayName, Enabled, Profile
```
To close it again: `Remove-NetFirewallRule -DisplayName "Ala Eh system"`.

Give this PC a fixed address (a DHCP reservation in the router), otherwise the
address, and so `CLIENT_ORIGIN`, can change after a reboot.

### C6. Smoke test (5 minutes)
- [ ] Sign in as admin.
- [ ] Dashboard loads; Online Entry and Offline Entry show products.
- [ ] Save one test entry, then undo or correct it.
- [ ] **Admin Queue** opens (it will list real missing entries and backup status).
- [ ] **Settings → Backup & Restore → Download Backup** works and appears in the history.
- [ ] Sign in from a second PC on the network.

---

## Part D. Optional: develop in VS Code

Only needed if someone will change the code. It runs on different ports from
the Docker install (client 5173, API 4000), so both can exist, but stop one
before changing the other's `CLIENT_ORIGIN`.

1. **A MySQL database for development.** Easiest, with Docker:
   ```powershell
   docker run -d --name ala-eh-dev-db -p 3306:3306 `
     -e MYSQL_ROOT_PASSWORD=devpassword -e MYSQL_DATABASE=ala_eh_stocks mysql:8.0
   ```
   (A native MySQL Server 8.4 + Workbench install also works: `winget install Oracle.MySQL Oracle.MySQLWorkbench`.
   Note the Docker stack in `docker-compose.yml` and a native server are separate databases - they do not share data.)
2. **Install packages** (from the project root; one command covers server and client):
   ```powershell
   npm install
   ```
3. **Server settings:**
   ```powershell
   Copy-Item server\.env.example server\.env
   Copy-Item client\.env.example client\.env
   ```
   Edit `server\.env`: set `DATABASE_URL` (for the container above:
   `mysql://root:devpassword@localhost:3306/ala_eh_stocks?connection_limit=10&pool_timeout=20`),
   `JWT_SECRET` (32+ chars) and `DATA_RESET_PASSCODE`.
4. **Create the tables and seed:**
   ```powershell
   cd server
   npx prisma migrate deploy      # applies the existing migrations (do NOT use "migrate dev" here)
   npm run seed                   # prints the one-time passwords
   cd ..
   ```
5. **Run:**
   ```powershell
   npm run dev
   ```
   Open http://localhost:5173.
6. **Checks before committing:**
   ```powershell
   npm run lint
   npm test
   ```
7. In-app **backup/restore in dev** needs `mysqldump` and `mysql` on the PATH, or
   `MYSQLDUMP_PATH` set in `server\.env` to the full path of `mysqldump.exe`.

---

## Part E. Keep it running without you

### E1. Starts by itself after a reboot
- Docker Desktop starts at sign-in (Part B4). The containers have
  `restart: unless-stopped`, so they come back with it.
- The PC must sign in to Windows after a reboot for Docker Desktop to start. For an
  always-on machine, set Windows to sign in automatically (`netplwiz`) and turn off
  sleep: **Settings → System → Power → Screen and sleep → Never** for "when plugged in".

### E2. Daily automatic backups
The database is not exposed to the host, so back it up through Docker.
Save this as `C:\ala-eh\docker-backup.ps1`:
```powershell
$ErrorActionPreference = "Stop"
Set-Location C:\ala-eh
$dir = "D:\ala-eh-backups"            # change: ideally a different drive
New-Item -ItemType Directory -Force $dir | Out-Null
$name = "ala-eh-" + (Get-Date -Format "yyyy-MM-dd-HHmm") + ".sql"

docker compose exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces ala_eh_stocks > /tmp/backup.sql'
docker compose cp db:/tmp/backup.sql "$dir\$name"

# A backup without the closing line is truncated: delete it and fail loudly.
if (-not (Select-String -Path "$dir\$name" -Pattern "-- Dump completed" -Quiet)) {
    Remove-Item "$dir\$name"
    throw "Backup was incomplete: $name"
}
# Keep 14 days.
Get-ChildItem $dir -Filter "ala-eh-*.sql" | Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) | Remove-Item
```
Schedule it for 02:15 every day (PowerShell as Administrator):
```powershell
schtasks /Create /TN "Ala Eh backup" /SC DAILY /ST 02:15 /RU SYSTEM `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ala-eh\docker-backup.ps1"
```
Test it once now: `schtasks /Run /TN "Ala Eh backup"`, then look in the backup folder.

**Copy backups off this PC** (cloud folder, USB, another PC). A backup on the same
disk does not survive that disk failing. Once a month, test-restore one on a spare
PC using the pre-restore check in Settings.

### E3. Updating to a newer version
```powershell
cd C:\ala-eh
# 1. Take a backup first (E2, or Settings -> Download Backup).
git pull
docker compose up -d --build
docker compose logs api --tail 30
```
Migrations apply automatically when the API starts.

### E4. HTTPS (only if it is reachable outside a trusted network)
The default setup is plain HTTP, fine on a closed office network. For anything
wider, use the HTTPS overlay described in [`PRODUCTION.md`](PRODUCTION.md)
("Docker deployment over HTTPS").

---

## Day-to-day commands (run in the project folder)

| Task | Command |
|---|---|
| Is it running? | `docker compose ps` |
| Start / stop | `docker compose up -d` / `docker compose stop` |
| Restart the API | `docker compose restart api` |
| API log | `docker compose logs api --tail 100 -f` |
| Reset one user's password | `docker compose exec api npx tsx prisma/resetPassword.ts <username> <new-password>` (8+ characters) |
| Rebuild after a code change | `docker compose up -d --build` |

Never run `docker compose down -v`. The `-v` deletes the database volume, which
is all of your data.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker compose up` stops with "set DB_PASSWORD in .env" | A required value in `.env` is empty. Fill every line of C2. |
| `api` keeps restarting | `docker compose logs api`. Usually `JWT_SECRET` under 32 characters, or `DATA_RESET_PASSCODE` is a placeholder. |
| Page loads, but sign-in or data fails with a CORS error | `CLIENT_ORIGIN` does not exactly match the address in the browser bar. Fix `.env`, then `docker compose up -d`. |
| Other PCs cannot open it | Windows Firewall rule (C5), or the PC's IP changed. |
| "Port is already allocated" | Something else uses 8080. Change `WEB_PORT` in `.env`, and `CLIENT_ORIGIN` to match. |
| `db` is unhealthy on the first start | Give it a minute. MySQL's first start is slow. `docker compose logs db`. |
| Restore says "Do not restore this file" | The file is incomplete or not a backup from this system. Take a new backup on the old PC. |
| Forgot the admin password | Use the reset command in the table above. |
| Backups page shows "overdue" | The in-app check only sees backups made from that page, unless `BACKUP_DIR` is configured. Download one, or ignore if the scheduled task (E2) is working. |
| Lost the generated seed passwords | Reset each account with the reset command. |

---

## Final checklist

- [ ] Backup from the old PC is saved in two places, and ends with `-- Dump completed`
- [ ] Git, Docker Desktop (start at sign-in), VS Code, Node installed
- [ ] `.env` filled in, `CLIENT_ORIGIN` matches the browser address
- [ ] `docker compose ps` shows all three services up
- [ ] Data restored and admin can sign in
- [ ] Smoke test (C6) passed, including from a second PC
- [ ] Firewall rule added; PC has a fixed IP; sleep turned off
- [ ] Daily backup task created and tested; backups copied off the PC
- [ ] Old PC kept (not wiped) until the new one has run for a week
