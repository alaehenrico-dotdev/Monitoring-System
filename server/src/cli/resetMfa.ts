// Recovery CLI: turn off two-step verification for a user who lost their phone AND
// their recovery codes. Anyone who can run this already has database access, so it adds
// no new power - it is the "break glass" for a locked-out admin.
//
// Usage:
//   Docker (the server): docker compose exec api node dist/cli/resetMfa.js <username>
//   From a checkout:     npm run reset-mfa --workspace server -- <username>
//                        npm run reset-mfa:docker --workspace server -- <username>  (Docker database from the host)
// Their sessions are signed out; they sign in with the password and can set up two-step again.
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2];
  if (!username || process.argv.length > 3) {
    console.error("Usage: resetMfa <username>");
    process.exit(1);
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    console.error(`No user found with username "${username}".`);
    process.exit(1);
  }
  await prisma.user.update({
    where: { username },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: Prisma.DbNull, tokenVersion: { increment: 1 } },
  });
  // eslint-disable-next-line no-console -- a command-line tool: its output is the console
  console.log(`Two-step verification turned off for "${username}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
