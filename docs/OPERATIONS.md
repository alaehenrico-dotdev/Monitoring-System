# Operations: keeping the data safe

Three things decide whether a bad day is recoverable: backups that are known to
restore, keys you can still find, and database changes that can be undone. The
deploy itself is in [DEPLOY-VPS.md](DEPLOY-VPS.md); Google Drive is in
[GOOGLE_DRIVE.md](GOOGLE_DRIVE.md).

## 1. Prove a backup restores (monthly)

A backup that has never been restored is only a hope. The drill restores a backup
into a throw-away database next to the real one, checks the data came back, and
drops it again. The live database is never written.

```bash
npm run restore:drill -- --latest                       # newest backup in BACKUP_DIR
npm run restore:drill -- --file /path/to/backup.sql.gz.enc   # one in particular (e.g. downloaded from Drive)
npm run restore:drill -- --latest --dry-run             # show the plan, touch nothing
```

- Run it on the server (it needs the `mysql` client, and a database user allowed to
  `CREATE` and `DROP` databases). It uses `scripts/restore.sh`, so encrypted `.enc`
  backups, the truncation checks and `BACKUP_ENCRYPTION_KEY` behave exactly as in a
  real restore.
- **Passed** means the core tables exist and `users`, `products` and the migration
  history are not empty, and it prints the newest stock entry in the backup. Check
  that date is recent.
- **Failed** means do not rely on that backup: look at the message, take a fresh
  backup, and drill again.
- Also run it after changing the backup key, the backup schedule or the server.
- Do one drill from a file **downloaded from Google Drive** now and then, not only
  from the server's own folder: that is the copy you would use if the server were gone.

## 2. Keys: keep a copy off the server

| Key | If it is lost |
| --- | --- |
| `BACKUP_ENCRYPTION_KEY` | Every encrypted backup, on the server and in Drive, is unreadable. There is no recovery. |
| `DRIVE_TOKEN_KEY` | Google Drive must be reconnected (Settings → Google Drive). Backups already in Drive are fine. |
| `JWT_SECRET` | Everyone is signed out. If `DRIVE_TOKEN_KEY` is **not** set, Drive is also disconnected (see below). |

- Store `BACKUP_ENCRYPTION_KEY` in a password manager or other place that is not the
  server. Check that you can read it back before you rely on it.
- **Set `DRIVE_TOKEN_KEY`** (`openssl rand -base64 32`). Without it the Drive token
  is protected by a key derived from `JWT_SECRET`, so rotating `JWT_SECRET` (an
  ordinary security step) silently disconnects Drive and the weekly backups stop.
  After setting it, reconnect Drive once so the token is stored under the new key.
- In production the server logs a `key-check` warning at start-up when either key is
  missing (`pm2 logs`). It does not stop the server.

## 3. Database changes you can undo

- Every deploy takes a database snapshot **before** migrating
  (`npm run db:migrate:deploy`), and stops if the snapshot fails.
- `npm run check:migrations` (also run by CI) fails a migration that can lose or
  rewrite data (drop, truncate, delete, update, rename, change a column's type)
  unless it is listed with a one-line explanation in
  `server/prisma/reviewed-migrations.json`. Writing that line is the moment to ask
  "how do we undo this?".
- Prefer two releases to one for anything destructive: first **add** the new column
  or table and start using it, then **remove** the old one in a later release, once
  nothing reads it. The first release can be rolled back by redeploying the old code;
  a dropped column can only be recovered from the snapshot.
- To go back after a bad migration: restore the pre-migration snapshot
  (`scripts/restore.sh --file <snapshot> --yes`), then redeploy the previous version.
  Anything entered since the snapshot is lost, so decide quickly.
