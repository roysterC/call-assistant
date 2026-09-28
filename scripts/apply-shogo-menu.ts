/**
 * Put Shogo's official price list on a database by hand. The work is in
 * scripts/shogo-menu-apply.ts. The deploy also applies it once by itself, and
 * after either, the deploy leaves Shogo's services alone for good.
 *
 * Shows what it would change and changes nothing, unless given --apply:
 *
 *   npx tsx scripts/apply-shogo-menu.ts            # preview
 *   npx tsx scripts/apply-shogo-menu.ts --apply    # write
 *
 * On production, run from /home/deploy/call-assistant, which reads .env.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { applyShogoMenu } from "./shogo-menu-apply";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

applyShogoMenu(prisma, { apply: process.argv.includes("--apply") })
  .then((r) => {
    if (r.result === "not-found") throw new Error(`Not applied: ${r.reason}.`);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
