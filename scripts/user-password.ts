/**
 * Reset a user's password from the server, for when the owner is locked out
 * and no email is configured (the default install has none).
 *
 *   docker compose exec web npm run user:password -- you@example.com
 *   docker compose exec web npm run user:password -- you@example.com 'new password'
 *
 * Without a password argument a random one is generated and printed once.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";
import { AccountError, setPassword } from "@/lib/users/accounts";

// Docker passes the environment in; a local checkout keeps it in .env.
// process.loadEnvFile is built in (Node >= 20.12), so no dotenv dependency.
if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const [email, given] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: npm run user:password -- <email> [new-password]");
    const users = await prisma.user.findMany({ select: { email: true }, orderBy: { createdAt: "asc" } });
    if (users.length) console.error(`Accounts on this server: ${users.map((u) => u.email).join(", ")}`);
    return 2;
  }
  const password = given ?? randomBytes(9).toString("base64url");
  try {
    if (!(await setPassword(email, password))) {
      console.error(`No account with email ${email}.`);
      return 1;
    }
  } catch (e) {
    if (e instanceof AccountError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  console.log(given ? `Password updated for ${email}.` : `New password for ${email}: ${password}`);
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    getRedisConnection().disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  });
