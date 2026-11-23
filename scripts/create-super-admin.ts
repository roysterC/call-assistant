/**
 * Create a new super-admin login, or lock an old one out.
 *
 * Usage, on the box (DATABASE_URL from the app's environment):
 *
 *   npx tsx scripts/create-super-admin.ts --email you@example.com --name "Your Name"
 *     Asks for the password twice, without showing it, so it never sits in
 *     the shell's history. The new login joins the organisation the existing
 *     super-admins belong to (Kikai's own), so it opens on the same pages.
 *     Refuses an email that already has a login: use set-user-password.ts
 *     to change a password, and nothing here quietly promotes a salon's staff.
 *
 *   npx tsx scripts/create-super-admin.ts --lock old@example.com
 *     For a login that should no longer get in: removes its password and ends
 *     every session it has open (sessionVersion). Its row stays, so anything
 *     it did keeps its name. Refuses to lock the last super-admin who can
 *     still sign in.
 *
 * No password on the command line: it would be kept in the shell's history.
 * Where there is no terminal to ask on (a pipe), NEW_PASSWORD is read instead.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import readline from "node:readline";
import { hashPassword, validatePassword } from "../src/lib/password";

function parseArgs(): { email?: string; name?: string; lock?: string } {
  const out: { email?: string; name?: string; lock?: string } = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") out.email = argv[++i];
    else if (argv[i] === "--name") out.name = argv[++i];
    else if (argv[i] === "--lock") out.lock = argv[++i];
  }
  return out;
}

/** Asks on the terminal without echoing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    let asked = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      // The question itself is shown; what is typed after it is not.
      if (!asked) {
        write(s);
        asked = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const fromEnv = process.env.NEW_PASSWORD ?? "";
    if (!fromEnv) throw new Error("No terminal to ask on: set NEW_PASSWORD for this one command.");
    return fromEnv;
  }
  const first = await askHidden("New password: ");
  const second = await askHidden("Same again: ");
  if (first !== second) throw new Error("The two passwords were not the same.");
  return first;
}

async function main() {
  const { email, name, lock } = parseArgs();
  if (!email && !lock) {
    console.error('Usage: --email <email> [--name "Name"]   or   --lock <email>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    if (lock) {
      const target = lock.toLowerCase().trim();
      const user = await prisma.user.findUnique({ where: { email: target }, select: { id: true, role: true } });
      if (!user) throw new Error(`No login has the email ${target}.`);
      if (user.role === "superAdmin") {
        const others = await prisma.user.count({
          where: { role: "superAdmin", id: { not: user.id }, passwordHash: { not: null } },
        });
        if (others === 0) throw new Error("That is the only super-admin who can sign in. Create the new one first.");
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: null, sessionVersion: { increment: 1 } },
      });
      console.log(`Locked ${target}: no password, and every session it had is ended.`);
      return;
    }

    const normalized = email!.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("That does not look like an email address.");
    if (await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } })) {
      throw new Error(`${normalized} already has a login. Use set-user-password.ts to change its password.`);
    }

    const existing = await prisma.user.findMany({
      where: { role: "superAdmin" },
      select: { email: true, organizationId: true, passwordHash: true },
      orderBy: { createdAt: "asc" },
    });
    const organizationId = existing.find((u) => u.organizationId)?.organizationId ?? null;

    const password = await readPassword();
    const problem = validatePassword(password);
    if (problem) throw new Error(problem);

    await prisma.user.create({
      data: {
        email: normalized,
        name: name?.trim() || null,
        role: "superAdmin",
        organizationId,
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`Created super-admin ${normalized}${organizationId ? "" : " (no organisation: none of the others has one)"}.`);
    const stillIn = existing.filter((u) => u.passwordHash).map((u) => u.email);
    if (stillIn.length) {
      console.log(`Super-admins who can still sign in: ${stillIn.join(", ")}`);
      console.log("Once you have signed in with the new one, lock an old one with: --lock <email>");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
