/**
 * Create or update a website-chat config (the embeddable widget's per-site
 * settings). This is the onboarding step for a new client site: it writes the
 * WebsiteConfig row that /api/website-chat/config and /embed read at runtime.
 *
 * The system prompt is read from a file rather than passed inline — these are
 * multi-thousand-word documents and shell quoting mangles them.
 *
 * Usage:
 *   npx tsx scripts/create-website-config.ts \
 *     --org doai \
 *     --siteId main-site \
 *     --name "Main Site" \
 *     --botName Monty \
 *     --prompt ./prompt.txt \
 *     --origins https://example.com,https://www.example.com \
 *     --greeting "Hey — what are you working on?" \
 *     --brandColor "#0D654A"
 *
 * --origins is required and deliberately has no default: an empty allowedOrigins
 * is currently treated as "allow any origin" by checkCORS, which would let anyone
 * drive this bot from any domain on our Anthropic bill.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function required(flag: string): string {
  const v = arg(flag);
  if (!v) {
    console.error(`Missing required --${flag}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const orgSlug = arg("org") || "doai";
  const siteId = required("siteId");
  const name = required("name");
  const promptPath = required("prompt");
  const origins = required("origins")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const systemPrompt = readFileSync(promptPath, "utf8");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  if (!org) throw new Error(`Organization '${orgSlug}' not found`);

  const quickReplies = (arg("quickReplies") || "")
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean);

  const data = {
    organizationId: org.id,
    name,
    botName: arg("botName") || "Assistant",
    systemPrompt,
    greeting: arg("greeting") || null,
    quickReplies,
    brandColor: arg("brandColor") || "#2563eb",
    allowedOrigins: origins,
    enabled: true,
  };

  const site = await prisma.websiteConfig.upsert({
    where: { siteId },
    create: { siteId, ...data },
    update: data,
  });

  console.log(`siteId:       ${site.siteId}`);
  console.log(`botName:      ${site.botName}`);
  console.log(`prompt chars: ${site.systemPrompt.length}`);
  console.log(`origins:      ${JSON.stringify(site.allowedOrigins)}`);
  console.log(`quickReplies: ${JSON.stringify(site.quickReplies)}`);
  console.log("");
  console.log("Embed snippet:");
  console.log(
    `  <script src="<your-crm-origin>/widget.js" data-site-id="${site.siteId}" async></script>`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
