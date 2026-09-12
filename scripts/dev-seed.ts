/**
 * Dev-only seed script. Creates a full DOAI org with enough sample data
 * to exercise every dashboard page.
 *
 * Usage:
 *   npm run dev:setup     # push schema + seed
 *   npm run dev:reset     # WIPE schema + seed
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const DOAI_ORG_ID = "doai-org-seed-0000000000001";
const DOAI_SETTINGS_ID = "doai-settings-seed-00000000001";

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("🌱 Seeding dev database...");

    // 1. DOAI organization
    const org = await prisma.organization.upsert({
      where: { slug: "doai" },
      update: {},
      create: {
        id: DOAI_ORG_ID,
        name: "DOAI Systems",
        slug: "doai",
        planTier: "custom",
      },
    });
    console.log("  ✓ Organization:", org.name);

    // 2. OrganizationSettings
    await prisma.organizationSettings.upsert({
      where: { organizationId: org.id },
      update: {
        whatsappEnabled: true,
        chatbotEnabled: true,
        voiceEnabled: true,
      },
      create: {
        id: DOAI_SETTINGS_ID,
        organizationId: org.id,
        businessName: "DOAI Systems",
        teamMembers: [
          {
            name: "Roy Cheung",
            email: "roy.cheung@doaisystems.co.uk",
            phone: "",
            role: "admin",
          },
        ],
        whatsappEnabled: true,
        chatbotEnabled: true,
        voiceEnabled: true,
      },
    });
    console.log("  ✓ OrganizationSettings");

    // 3. Super-admin user
    const hash = await bcrypt.hash("dev", 10);
    await prisma.user.upsert({
      where: { email: "roy.cheung@doaisystems.co.uk" },
      update: {
        role: "superAdmin",
        organizationId: org.id,
        passwordHash: hash,
      },
      create: {
        email: "roy.cheung@doaisystems.co.uk",
        name: "Roy Cheung",
        role: "superAdmin",
        organizationId: org.id,
        passwordHash: hash,
      },
    });
    console.log("  ✓ Super-admin user (password: 'dev')");

    // 4. Demo website config
    await prisma.websiteConfig.upsert({
      where: { siteId: "demo" },
      update: {},
      create: {
        organizationId: org.id,
        siteId: "demo",
        name: "Demo Site",
        botName: "Alex",
        systemPrompt:
          "You are Alex, a friendly AI assistant for DOAI. Be concise, helpful, and professional.",
        greeting: "Hi! I'm Alex. How can I help?",
        quickReplies: ["Tell me about DOAI", "Book a call", "See pricing"],
        brandColor: "#2563eb",
        allowedOrigins: [],
        enabled: true,
      },
    });
    console.log("  ✓ Demo website config (siteId=demo)");

    // 5. Sample lead
    const lead = await prisma.lead.upsert({
      where: {
        organizationId_phone: {
          organizationId: org.id,
          phone: "+447700900000",
        },
      },
      update: {},
      create: {
        organizationId: org.id,
        phone: "+447700900000",
        name: "Jane Example",
        email: "jane@example.com",
        company: "Example Ltd",
        issue: "Interested in voice agent for a plumbing business",
        source: "phone",
        status: "new",
      },
    });
    console.log("  ✓ Sample lead:", lead.name);

    // 6. Sample call
    const existingCall = await prisma.call.findFirst({
      where: { organizationId: org.id, phoneNumber: lead.phone ?? "" },
    });
    if (!existingCall) {
      await prisma.call.create({
        data: {
          organizationId: org.id,
          vapiCallId: `dev-call-${Date.now()}`,
          phoneNumber: lead.phone ?? "",
          status: "completed",
          duration: 180,
          transcript:
            "AI: Hello, how can I help?\nUser: I'm looking for a voice agent for my plumbing business\nAI: Great! We can set that up...",
          summary:
            "Caller interested in voice agent for plumbing business. Wants a callback.",
          sentiment: "positive",
          costCents: 45,
          endReason: "customer_ended",
          leadId: lead.id,
        },
      });
      console.log("  ✓ Sample call");
    }

    // 7. Sample WhatsApp conversation
    const existingConv = await prisma.whatsAppConversation.findUnique({
      where: {
        organizationId_waId: {
          organizationId: org.id,
          waId: "447700900000",
        },
      },
    });
    if (!existingConv) {
      const conv = await prisma.whatsAppConversation.create({
        data: {
          organizationId: org.id,
          waId: "447700900000",
          phoneNumber: lead.phone ?? "",
          contactName: "Jane Example",
          leadId: lead.id,
          status: "active",
          isRead: false,
        },
      });
      await prisma.whatsAppMessage.createMany({
        data: [
          {
            conversationId: conv.id,
            role: "user",
            content: "Hi, do you do voice agents?",
          },
          {
            conversationId: conv.id,
            role: "assistant",
            content:
              "Hi Jane! Yes, we build custom voice agents for small businesses. Can you tell me a bit about what you're looking for?",
          },
          {
            conversationId: conv.id,
            role: "user",
            content:
              "Need to stop missing calls when the team is on site — we're losing jobs",
          },
        ],
      });
      console.log("  ✓ Sample WhatsApp conversation (3 messages)");
    }

    // 8. Sample callback
    const existingCallback = await prisma.callback.findFirst({
      where: { organizationId: org.id, leadId: lead.id },
    });
    if (!existingCallback) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      await prisma.callback.create({
        data: {
          organizationId: org.id,
          leadId: lead.id,
          assignedTo: "Roy Cheung",
          scheduledAt: tomorrow,
          status: "pending",
          notes: "Demo callback for testing the callbacks page",
        },
      });
      console.log("  ✓ Sample callback (tomorrow 10am)");
    }

    console.log("\n✅ Dev seed complete.");
    console.log("   Sign in at http://localhost:4500/login");
    console.log("   Email: roy.cheung@doaisystems.co.uk");
    console.log("   Password: dev");
    console.log(
      "   (Or set DEV_BYPASS_AUTH=1 in .env.local to skip login entirely.)"
    );

    await prisma.$disconnect();
  } catch (err) {
    console.error("❌ Seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
