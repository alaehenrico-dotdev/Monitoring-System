/// MariaDB's mysqldump (what `default-mysql-client` installs in the API image)
/// writes this conditional comment as the very first line since its 2024
/// security releases, ahead of the usual "-- MariaDB dump" header. MySQL treats
/// `/*M!...*/` as a plain comment. It is the ONLY thing allowed in front of the
/// header, so the check still refuses an arbitrary file or hand-written script.
const SANDBOX_LINE = /^\/\*M!\d+\\?- enable the sandbox mode \*\/[ \t]*\r?\n/;
const DUMP_HEADER = /^-- (MySQL|MariaDB) dump/;

/// Whether `text` (the first few hundred bytes of an upload) opens the way a
/// mysqldump file made by this system's Download Backup does.
export function isMysqldumpHeader(text: string): boolean {
  const start = text.replace(/^\uFEFF/, "");
  return DUMP_HEADER.test(start.replace(SANDBOX_LINE, ""));
}
