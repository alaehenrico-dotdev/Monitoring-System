// Encrypt or decrypt a backup stream, for the backup scripts and for opening a
// downloaded .enc file by hand:
//   node dist/cli/backupCrypt.js encrypt < dump.sql.gz > dump.sql.gz.enc
//   node dist/cli/backupCrypt.js decrypt < dump.sql.enc  > dump.sql
// The key is BACKUP_ENCRYPTION_KEY from the environment or server/.env. Nothing
// else is read from .env, and the key is never printed.
import "dotenv/config";
import { pipeline } from "node:stream/promises";
import { createBackupDecryptor, createBackupEncryptor, parseBackupKey } from "../utils/backupCrypto";

async function main() {
  const mode = process.argv[2];
  if (mode !== "encrypt" && mode !== "decrypt") throw new Error("Usage: backupCrypt.js <encrypt|decrypt>  (data on stdin, result on stdout)");
  const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("BACKUP_ENCRYPTION_KEY is not set (environment or server/.env).");
  const key = parseBackupKey(raw);
  await pipeline(process.stdin, mode === "encrypt" ? createBackupEncryptor(key) : createBackupDecryptor(key), process.stdout);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
