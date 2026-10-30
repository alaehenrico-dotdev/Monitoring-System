// Recovery CLI: set a user's password directly on the database - for when nobody can
// sign in as an admin to use Settings > User Passwords (or to rotate the seeded accounts).
//
// Usage (from server/):
//   npx tsx prisma/resetPassword.ts <username>
// The new password is typed at a hidden prompt, or taken from NEW_PASSWORD for scripts.
// It is deliberately NOT a command-line argument: arguments end up in shell history and
// in the process list where other users of the machine can read them.
//
// Same effects as the in-app reset: the new password must pass the password rules, every
// session opened with the old password is signed out (tokenVersion), and the person has
// to choose their own password at their next sign-in.
import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordProblem } from "../src/utils/password";

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
  const username = process.argv[2];
  if (!username || process.argv.length > 3) {
    console.error("Usage: npx tsx prisma/resetPassword.ts <username>   (password is asked for, or set NEW_PASSWORD)");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    console.error(`No user found with username "${username}".`);
    process.exit(1);
  }

  let password = process.env.NEW_PASSWORD;
  if (!password) {
    password = await askHidden("New password: ");
    if (password !== (await askHidden("Repeat it:   "))) {
      console.error("The two entries do not match.");
      process.exit(1);
    }
  }
  const problem = passwordProblem(password, username);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  await prisma.user.update({
    where: { username },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true, tokenVersion: { increment: 1 } },
  });
  // eslint-disable-next-line no-console -- a command-line tool: its output is the console
  console.log(`Password updated for "${username}". Their other sessions are signed out, and they must choose a new password at next sign-in.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
