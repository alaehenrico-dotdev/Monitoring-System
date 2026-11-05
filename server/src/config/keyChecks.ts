/**
 * Boot-time reminders about the two optional keys that decide whether a bad day is
 * recoverable. Neither stops the server (both are legitimately optional, and failing
 * a working production at boot would be worse than the risk): they are logged once
 * as warnings so they show up in `pm2 logs` and any log alert, and only in
 * production, where the risk is real.
 *
 *  - DRIVE_TOKEN_KEY: without it the stored Google Drive token is encrypted with a
 *    key derived from JWT_SECRET, so rotating the login secret (an ordinary security
 *    step) silently disconnects Drive and the backups stop.
 *  - BACKUP_ENCRYPTION_KEY: without it every backup, including the copies in Google
 *    Drive, is a readable database dump.
 */
export interface KeyCheckInput {
  nodeEnv: string;
  googleClientId: string;
  googleClientSecret: string;
  driveTokenKey: string;
  backupEncryptionKey: unknown;
}

export function keyWarnings(cfg: KeyCheckInput): string[] {
  if (cfg.nodeEnv !== "production") return [];
  const warnings: string[] = [];
  if (cfg.googleClientId && cfg.googleClientSecret && !cfg.driveTokenKey) {
    warnings.push(
      "DRIVE_TOKEN_KEY is not set: the Google Drive token is protected by a key derived from JWT_SECRET, so changing JWT_SECRET will disconnect Google Drive. Set DRIVE_TOKEN_KEY (docs/OPERATIONS.md).",
    );
  }
  if (!cfg.backupEncryptionKey) {
    warnings.push(
      "BACKUP_ENCRYPTION_KEY is not set: database backups, including the copies in Google Drive, are written unencrypted. Set it and keep a copy off this server (docs/OPERATIONS.md).",
    );
  }
  return warnings;
}

export function logKeyWarnings(cfg: KeyCheckInput): void {
  for (const message of keyWarnings(cfg)) {
    console.warn(JSON.stringify({ level: "warn", event: "key-check", message }));
  }
}
