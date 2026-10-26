#!/usr/bin/env node
/* eslint-disable no-console -- a CLI: printing is its output */
// Guards the database against an unreviewed risky migration.
//
// Scans server/prisma/migrations/*/migration.sql for statements that can lose or
// rewrite existing data, or that fail on a table that already has rows:
//   DROP TABLE / COLUMN / INDEX, TRUNCATE, DELETE FROM, UPDATE, MODIFY / CHANGE /
//   RENAME, and ADD COLUMN ... NOT NULL with no DEFAULT.
// A migration that matches must be listed in server/prisma/reviewed-migrations.json
// (name -> one line saying what it does to data and how it was checked). An
// unlisted match fails the check, so nothing like that ships unnoticed.
//
//   node scripts/check-migrations.mjs        # check (exit 1 on an unreviewed one)
//   node scripts/check-migrations.mjs --list # show every risky statement found
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "server", "prisma", "migrations");
const reviewedFile = join(root, "server", "prisma", "reviewed-migrations.json");

const RULES = [
  [/\bDROP\s+TABLE\b/i, "drops a table"],
  [/\bDROP\s+COLUMN\b/i, "drops a column"],
  [/\bDROP\s+INDEX\b/i, "drops an index"],
  [/\bTRUNCATE\b/i, "truncates a table"],
  [/\bDELETE\s+FROM\b/i, "deletes rows"],
  [/^\s*UPDATE\s/im, "rewrites existing rows"],
  [/\b(MODIFY|CHANGE)\s+(COLUMN\s+)?`/i, "changes a column's type"],
  [/\bRENAME\b/i, "renames something"],
];

export function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

export function findRisks(sql) {
  const clean = stripComments(sql);
  const risks = RULES.filter(([re]) => re.test(clean)).map(([, why]) => why);
  // Each ADD COLUMN clause on its own: NOT NULL with no DEFAULT breaks on a table with rows.
  for (const clause of clean.split(/,\s*(?=ADD\s+COLUMN)|;/i)) {
    if (/\bADD\s+COLUMN\b/i.test(clause) && /\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause)) {
      risks.push("adds a NOT NULL column with no default");
      break;
    }
  }
  return risks;
}

function main() {
  const reviewed = existsSync(reviewedFile) ? JSON.parse(readFileSync(reviewedFile, "utf8")) : {};
  const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const listOnly = process.argv.includes("--list");
  const unreviewed = [];
  for (const name of names) {
    const file = join(migrationsDir, name, "migration.sql");
    if (!existsSync(file)) continue;
    const risks = findRisks(readFileSync(file, "utf8"));
    if (risks.length === 0) continue;
    if (listOnly) console.log(`${name}: ${risks.join("; ")}${reviewed[name] ? "  [reviewed]" : ""}`);
    if (!reviewed[name]) unreviewed.push({ name, risks });
  }
  const stale = Object.keys(reviewed).filter((n) => !names.includes(n));
  for (const n of stale) console.warn(`warning: reviewed-migrations.json lists "${n}" but no such migration exists`);
  if (unreviewed.length === 0) {
    if (!listOnly) console.log(`OK: ${names.length} migrations, no unreviewed data-risky statements.`);
    return;
  }
  console.error("Unreviewed risky migration(s):");
  for (const u of unreviewed) console.error(`  ${u.name}: ${u.risks.join("; ")}`);
  console.error(
    "\nTest each on a restored copy of real data (compare row counts and totals before/after),\n" +
      "take a backup before deploying, then add it to server/prisma/reviewed-migrations.json\n" +
      'as "<name>": "what it does to data / how you checked".',
  );
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
