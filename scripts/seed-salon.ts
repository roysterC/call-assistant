/**
 * Dev-only. Configures a salon organization for Google Calendar booking.
 *
 * Exists because the settings UI for hours / services / stylist calendar ids
 * has not been built yet. Delete this script once it has.
 *
 * Usage:
 *   npx tsx scripts/seed-salon.ts
 *
 * Stylist calendar ids come from the environment so real addresses never land
 * in git. Set whichever you have — a stylist without one is simply not
 * bookable, which is the correct behaviour and worth seeing:
 *
 *   SHOGO_CAL_JO=jo@example.com
 *   SHOGO_CAL_SIOBHAN=...
 *   SHOGO_CAL_MARCUS=...
 *   SHOGO_CAL_PRIYA=...
 *   SHOGO_CAL_CHLOE=...
 *
 * Also creates a PhoneNumber row so `resolveOrgFromVapiPayload` can map an
 * inbound call to this org. Override the number with SHOGO_PHONE.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SHOGO_CONTACT_PHONE, SHOGO_FAQ, SHOGO_HOURS, SHOGO_SERVICES } from "./shogo-menu";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SLUG = "shogo";
const PHONE = process.env.SHOGO_PHONE || "+441234567890";

// Shogo's official hours and price list (scripts/shogo-menu.ts).
const BUSINESS_HOURS = SHOGO_HOURS;
const SERVICES = SHOGO_SERVICES;

const STYLISTS = [
  {
    name: "Jo",
    role: "Owner — colour specialist",
    calendarEnv: "SHOGO_CAL_JO",
    workingDays: [2, 3, 4, 5, 6],
    services: [] as string[], // empty = all services
  },
  {
    name: "Siobhan",
    role: "Senior stylist — cutting, curly hair",
    calendarEnv: "SHOGO_CAL_SIOBHAN",
    workingDays: [2, 3, 5, 6],
    services: ["Ladies cut and blow dry", "Wash and blow dry, short hair", "Wash and blow dry, medium hair", "Wash and blow dry, long hair"],
  },
  {
    name: "Marcus",
    role: "Stylist — barbering",
    calendarEnv: "SHOGO_CAL_MARCUS",
    workingDays: [3, 4, 5, 6],
    services: ["Men's cut and dry", "Ladies cut and blow dry", "Children's cut, age 7 to 12", "Children's cut, age 13 to 16"],
  },
  {
    name: "Priya",
    role: "Stylist — blow dries, occasion hair",
    calendarEnv: "SHOGO_CAL_PRIYA",
    workingDays: [4, 5, 6],
    services: ["Wash and blow dry, medium hair", "Wash and blow dry, long hair", "Hair up, party style", "Bridal hair"],
  },
  {
    name: "Chloe",
    role: "Junior stylist",
    calendarEnv: "SHOGO_CAL_CHLOE",
    workingDays: [2, 3, 4, 5],
    services: ["Wash and blow dry, short hair", "Wash and blow dry, medium hair", "Olaplex treatment", "Children's cut, age 0 to 6"],
  },
];

async function main() {
  console.log("Seeding Shogo salon config...\n");

  const org = await prisma.organization.upsert({
    where: { slug: SLUG },
    update: {},
    create: { name: "Shogo", slug: SLUG, planTier: "custom" },
  });
  console.log(`  Organization: ${org.name} (${org.id})`);

  const teamMembers = STYLISTS.map((s) => ({
    name: s.name,
    email: "",
    phone: "",
    role: s.role,
    googleCalendarId: process.env[s.calendarEnv] || "",
    workingDays: s.workingDays,
    services: s.services,
  }));

  const bookable = teamMembers.filter((m) => m.googleCalendarId);

  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {
      businessName: "Shogo",
      teamMembers,
      businessHours: BUSINESS_HOURS,
      services: SERVICES,
      timezone: "Europe/London",
      contactPhone: SHOGO_CONTACT_PHONE,
      salonFaq: SHOGO_FAQ,
      voiceEnabled: true,
    },
    create: {
      organizationId: org.id,
      businessName: "Shogo",
      teamMembers,
      businessHours: BUSINESS_HOURS,
      services: SERVICES,
      timezone: "Europe/London",
      contactPhone: SHOGO_CONTACT_PHONE,
      salonFaq: SHOGO_FAQ,
      voiceEnabled: true,
    },
  });
  console.log(`  Settings: ${SERVICES.length} services, ${BUSINESS_HOURS.length} days`);
  console.log(`  Stylists: ${teamMembers.length} configured, ${bookable.length} bookable`);

  for (const m of teamMembers) {
    const mark = m.googleCalendarId ? "OK " : "-- ";
    console.log(`    ${mark}${m.name}${m.googleCalendarId ? ` -> ${m.googleCalendarId}` : " (no calendar id)"}`);
  }

  // Lets resolveOrgFromVapiPayload map an inbound call to this org.
  await prisma.phoneNumber.upsert({
    where: { number: PHONE },
    update: { organizationId: org.id, channel: "vapi", active: true },
    create: {
      organizationId: org.id,
      number: PHONE,
      channel: "vapi",
      label: "Shogo inbound (dev)",
      active: true,
    },
  });
  console.log(`  Phone number: ${PHONE} -> ${org.id}`);

  console.log("\nProvider selection requires ALL of:");
  console.log(
    `  ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY ? "OK " : "-- "}Google credentials in env`
  );
  console.log(`  ${bookable.length > 0 ? "OK " : "-- "}at least one stylist calendar id`);
  console.log(`  ${SERVICES.length > 0 ? "OK " : "-- "}services configured`);
  console.log(`  ${BUSINESS_HOURS.length > 0 ? "OK " : "-- "}business hours configured`);
  console.log(
    "\nIf any line shows --, the org falls back to the manual provider and the"
  );
  console.log("agent will correctly refuse to check availability.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
