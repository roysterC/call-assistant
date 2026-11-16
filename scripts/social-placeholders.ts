/**
 * Clear out the made-up clients Instagram and Messenger messages used to make
 * (src/lib/social-placeholders.ts). The deploy does this by itself after
 * every release; this is for seeing what it would do, or doing it by hand.
 *
 *   npx tsx scripts/social-placeholders.ts            # preview
 *   npx tsx scripts/social-placeholders.ts --apply    # write
 *
 * On production, run from /home/deploy/call-assistant, which reads .env.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { cleanUpSocialPlaceholders } from "../src/lib/social-placeholders";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const apply = process.argv.includes("--apply");

cleanUpSocialPlaceholders(prisma, { apply, log: (line) => console.log(`  ${line}`) })
  .then((r) =>
    console.log(
      `${apply ? "Done" : "Preview (nothing changed; --apply to write)"}: ` +
        `${r.merged} merged into the real client, ${r.removed} removed, ${r.kept} kept.`
    )
  )
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
