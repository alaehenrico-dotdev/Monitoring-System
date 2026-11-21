// Command-line way to add an account - the app has no "new user" screen. Written for the
// AUDITOR role (a person who counts stock blind on a phone), but any role works.
//
// Usage (from server/):
//   npm run create-user -- <username> <ROLE> <full name...>
//   npm run create-user:docker -- <username> <ROLE> <full name...>   (Docker database from the host)
//   docker compose exec api node dist/cli/createUser.js <username> <ROLE> <full name...>
// ROLE is AUDITOR, ENCODER or SUPERVISOR_ADMIN. The password is typed at a hidden prompt, or
// taken from NEW_PASSWORD for scripts - never a command-line argument (shell history, process list).
//
// Same rules as an admin-created account: the password must pass the password rules, and the
// person has to choose their own password at their first sign-in. The creation goes into the
// change log like any other account change.
import { PrismaClient, Role } from "@prisma/client";
import { passwordProblem } from "../utils/password";
import { createUser } from "../services/users.service";

const prisma = new PrismaClient();

function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("No terminal to type the password in - set NEW_PASSWORD instead."));
    process.stdout.write(question);
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") process.exit(130); // Ctrl+C
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const [username, roleArg, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  const roles = Object.values(Role) as string[];
  if (!username || !roleArg || !name) {
    console.error(`Usage: createUser <username> <${roles.join("|")}> <full name...>`);
    process.exit(1);
  }
  const role = roleArg.toUpperCase();
  if (!roles.includes(role)) {
    console.error(`Unknown role "${roleArg}". Use one of: ${roles.join(", ")}.`);
    process.exit(1);
  }

  let password = process.env.NEW_PASSWORD;
  if (!password) {
    password = await askHidden("Temporary password: ");
    if (password !== (await askHidden("Repeat it:         "))) {
      console.error("The two entries do not match.");
      process.exit(1);
    }
  }
  const problem = passwordProblem(password, username);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  const created = await createUser({ name, username, password, role: role as Role });
  await prisma.user.update({ where: { id: created.id }, data: { mustChangePassword: true } });
  // eslint-disable-next-line no-console -- a command-line tool: its output is the console
  console.log(`Created ${role} "${username}" (${name}). They choose their own password at first sign-in.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
