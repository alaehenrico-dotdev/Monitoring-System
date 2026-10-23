# Google Drive backups and export copies

Settings > **Google Drive** connects the system to one Google account. Once connected:

- **Database backups** are taken automatically at the **end of every month** (the last day, at the hour you
  set; and on demand with *Back up now*), gzipped, and uploaded to a
  Drive folder called **Ala Eh Stock Monitoring - Backups**. The newest *N* are kept (default 14); older ones go to
  the Drive trash. Each one also appears in the existing Backup history, and a failed one raises the same
  "backup failed / overdue" warnings as any other.
- **Generating the Daily Report** (the Generate button, after a confirmation) saves that date's report to Drive
  straight away - see the next point for what the file is. Generating a date again replaces the file, and does
  nothing when Drive already holds exactly the same report, so there is never more than one file per date.
- **Daily Report PDFs** are saved automatically: the moment a day's report is saved (an encoder
  finishes the day, "Finish through" runs, or a correction re-saves a frozen report), and again with each
  backup (monthly, and on *Back up now*) for the latest day and the day before it, as a catch-up. Each is an
  PDF (`daily-report-YYYY-MM-DD.pdf`, with a Summary, then the Online, Offline, Consolidated, Daily Out and Audit
  tables) in
  **Ala Eh Stock Monitoring - Reports / year / month**. A day's
  file is replaced with the current one each time, so Drive holds one file per day; earlier days stay, so the
  folder is a running archive. A finished day's file is its frozen report. If saving a report fails the
  backup still stands, and the failure shows in the recent uploads list.
- **Excel, CSV, PDF and end-of-day pack exports** are copied to **Ala Eh Stock Monitoring - Exports** at the moment
  someone downloads them. The person still gets their normal download; the copy is sent in the background and
  never blocks or fails it.

The app only gets Google's narrow **`drive.file`** permission: it can see and change only the files and
folders it created itself, never anything else in the account's Drive.

## One-time setup (about 10 minutes)

### 1. Create the Google credentials

1. Go to <https://console.cloud.google.com/> and create a project (for example "Ala Eh Monitoring").
2. **APIs & Services > Library**: search for **Google Drive API** and click **Enable**.
3. **APIs & Services > OAuth consent screen** (called *Google Auth Platform* in newer consoles):
   - User type **External**, app name "Ala Eh Monitoring", your email as support and developer contact.
   - **Scopes**: add `.../auth/drive.file` (plus `openid` and `email`, which are added by default).
   - **Publishing status: click *Publish app* so it is "In production".**
     If it stays in *Testing*, Google expires the connection after 7 days and backups silently stop.
     `drive.file` is not a sensitive scope, so publishing needs no Google review; an
     "unverified app" warning on the consent screen is expected and safe to click through.
4. **APIs & Services > Credentials > Create credentials > OAuth client ID**:
   - Application type **Web application**.
   - **Authorized redirect URIs**: add exactly `http://localhost:8080/api/drive/oauth/callback`
     (use your own port if `WEB_PORT` is not 8080).
   - Create it and copy the **Client ID** and **Client secret**.

### 2. Give them to the server

In the `.env` next to `docker-compose.yml`:

```
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Then `docker compose up -d --build`. (The first start applies a small migration that adds two tables.)

### 3. Connect, from the PC that runs Docker

Open the app at **`http://localhost:8080`** on that PC (not the LAN address), sign in as an admin, and go to
Settings > Google Drive > **Connect Google Drive**. Choose the Google account, allow access, and you land back
on Settings showing the account.

> **Why from that PC:** Google only accepts plain `http` redirect addresses for `localhost`. Everything after
> connecting (backups, exports from any PC on the network) works from any address.

> **Backup-overdue warning:** the Admin Queue flags "Backup overdue" when the newest backup is older than
> `BACKUP_OVERDUE_HOURS` (36 by default, which suits a daily backup). When the monthly Drive backup is your only
> scheduled backup (no `BACKUP_DIR` with daily scripts), the limit widens by itself to 33 days, so the warning
> does not show most of the month. If you do run daily backup scripts and set `BACKUP_DIR`, the 36-hour
> default stays in force.

## What is stored, and where

- The Google **refresh token** is stored in the database, encrypted (AES-256-GCM) with a key derived from
  `JWT_SECRET` - or from `DRIVE_TOKEN_KEY` if you set one. It is never sent to the browser. Database backups
  therefore contain the *encrypted* token only. If you change the key, reconnect Drive.
- The **client secret** lives only in `.env` / the api container's environment.
- Backups hold every record and the password hashes. Keep the Drive account private, and share the
  backups folder only with people who should see everything.

## Day-to-day

- **Settings > Google Drive** shows the account and one card for each thing saved automatically - *Daily
  reports* (when the last one landed; nothing to switch), *Database backup* and *Export copies* - then a
  *Recent activity* list you can filter by Reports, Backups or Exports (failures are counted and show their
  reason). The switches: monthly backup on/off and its time, how many backups to keep,
  and whether to save export copies.
- **Disconnect** revokes the token at Google and forgets it here. Files already in Drive stay.
- If you remove the app at <https://myaccount.google.com/permissions>, or Google expires the grant, the page
  shows *"reconnect Google Drive"*; click **Connect** again. Reconnecting the same account keeps its folders
  and settings.

## Folder names

The system keeps exactly three folders in Drive, named:

- **Ala Eh Stock Monitoring - Backups**
- **Ala Eh Stock Monitoring - Reports** (with `year/month` inside)
- **Ala Eh Stock Monitoring - Exports**

It never makes a second folder of a name that already exists: it reuses the one there (the oldest, if there
are strays), and creates one only when none exists. Folders made under an older name ("Ala Eh Monitoring - …"
or "Ala Eh Stocks Monitoring - Reports") are **renamed in place** - same folder, same files - when the
server starts, then at most once an hour, and when you connect. If a folder with the exact name already
exists, the system uses that one and leaves the old one alone rather than create a duplicate name. Folders
you delete or trash are found by name again or made once. Year and month folders inside Reports are
created one at a time, so reports saved at the same moment never make two.

## Toasts

Everything saved to Drive shows a toast, so nobody has to open Settings to know it worked:

- a **scheduled backup** and a **Daily Report** saved by the server - shown to every signed-in admin (a failure
  stays on screen until it is closed);
- an **export copy** - shown to the person who downloaded the file;
- **Back up now** - answers the admin who clicked it.

Toasts only reach people who have the app open at that moment; the full history is always in *Recent
activity* on Settings > Google Drive.

## Restoring from a Drive backup

Download the `.sql.gz` from Drive, unzip it (`gunzip`, or 7-Zip on Windows), and use
Settings > Backup & Restore > Restore with the resulting `.sql`.

## Troubleshooting

| Message | Meaning |
|---|---|
| *Google Drive is not set up on this server* | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are empty in `.env`. |
| `redirect_uri_mismatch` on Google's page | The redirect URI in Google Cloud differs from the one the server uses. Compare them with the address shown on the Settings page. |
| *Google did not return a long-lived access token* | The account had already approved the app. Remove it at myaccount.google.com/permissions and connect again. |
| *reconnect Google Drive* | Access was revoked or expired (see the *In production* note above). |
| Backup fails with *mysqldump isn't installed* | The api container needs the MySQL client; the provided Dockerfile has it. |
| `Quota exceeded` | The Google account's Drive is full. |
