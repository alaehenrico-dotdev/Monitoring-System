// One-off CLI to rotate a user's password directly - there is no in-app
// "change password" or admin "reset user password" feature yet (see
// routes/users.routes.ts: list/create/activate only), so this is the only
// way to change a password on an account that already exists. Mainly meant
// for rotating the default admin/online.encoder/offline.encoder accounts
// seed.ts creates, since re-running the seed never touches an existing user.
//
// Usage (from server/):
//   npx tsx prisma/resetPassword.ts <username> <new-password>
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: npx tsx prisma/resetPassword.ts <username> <new-password>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    console.error(`No user found with username "${username}".`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { username }, data: { passwordHash } });
  // eslint-disable-next-line no-console
  console.log(`Password updated for "${username}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
