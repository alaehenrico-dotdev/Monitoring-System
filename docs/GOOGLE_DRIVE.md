# Google Drive backups and export copies

Settings > **Google Drive** connects the system to one Google account. Once connected:

- **Database backups** are taken once a day (and on demand with *Back up now*), gzipped, and uploaded to a
  Drive folder called **Ala Eh Monitoring - Backups**. The newest *N* are kept (default 14); older ones go to
  the Drive trash. Each one also appears in the existing Backup history, and a failed one raises the same
  "backup failed / overdue" warnings as any other.
- **Excel, CSV, PDF and end-of-day pack exports** are copied to **Ala Eh Monitoring - Exports** at the moment
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

## What is stored, and where

- The Google **refresh token** is stored in the database, encrypted (AES-256-GCM) with a key derived from
  `JWT_SECRET` - or from `DRIVE_TOKEN_KEY` if you set one. It is never sent to the browser. Database backups
  therefore contain the *encrypted* token only. If you change the key, reconnect Drive.
- The **client secret** lives only in `.env` / the api container's environment.
- Backups hold every record and the password hashes. Keep the Drive account private, and share the
  backups folder only with people who should see everything.

## Day-to-day

- **Settings > Google Drive** shows the account, the last backup, any problem, the recent uploads
  (successful and failed), and the switches: daily backup on/off and its time, how many backups to keep,
  and whether to save export copies.
- **Disconnect** revokes the token at Google and forgets it here. Files already in Drive stay.
- If you remove the app at <https://myaccount.google.com/permissions>, or Google expires the grant, the page
  shows *"reconnect Google Drive"*; click **Connect** again. Reconnecting the same account keeps its folders
  and settings.

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
