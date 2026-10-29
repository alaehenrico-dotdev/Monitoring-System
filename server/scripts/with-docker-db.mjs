// Runs a command against the Docker database (host port 3308) without touching
// server/.env or the calling shell's environment: DATABASE_URL is set only for
// the child process, built from DB_PASSWORD in the project-root .env.
//   node scripts/with-docker-db.mjs tsx prisma/seed.ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
const { DB_PASSWORD, DB_HOST_PORT = "3308" } = dotenv.parse(await import("node:fs").then((fs) => fs.readFileSync(rootEnv)));
if (!DB_PASSWORD) {
  console.error(`DB_PASSWORD not found in ${rootEnv}`);
  process.exit(1);
}

const url = `mysql://alaeh_app:${encodeURIComponent(DB_PASSWORD)}@127.0.0.1:${DB_HOST_PORT}/ala_eh_stocks?connection_limit=10&pool_timeout=20`;
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/with-docker-db.mjs <command> [args...]");
  process.exit(1);
}

process.stdout.write(`[docker-db] running against 127.0.0.1:${DB_HOST_PORT}
`);
const child = spawn(cmd, args, { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: url } });
child.on("exit", (code) => process.exit(code ?? 1));
