/**
 * Put Shogo's official price list on a database: services and prices,
 * opening hours, the salon's number, and the notes on the list as the Salon
 * FAQs. The data is in scripts/shogo-menu.ts.
 *
 * Shows what it would change and changes nothing, unless given --apply:
 *
 *   npx tsx scripts/apply-shogo-menu.ts            # preview
 *   npx tsx scripts/apply-shogo-menu.ts --apply    # write
 *
 * On production, run from /home/deploy/call-assistant, which reads .env.
 *
 * Replaces the service list outright. Stylists who only do some services have
 * their lists moved onto the new names (scripts/shogo-menu.ts, OLD_TO_NEW);
 * anything with no new equivalent is dropped and reported. The Salon FAQs are
 * only written if the salon has not written its own. Appointments already in
 * the diary keep the service name they were booked with.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { openWeekdays, parseBusinessHours } from "../src/lib/business-hours";
import { constrainWorkingDays, parseServices, parseStylists } from "../src/lib/salon-config";
import { parseSalonFaq } from "../src/lib/salon-knowledge";
import { remapStylistServices, SHOGO_CONTACT_PHONE, SHOGO_FAQ, SHOGO_HOURS, SHOGO_SERVICES } from "./shogo-menu";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: "shogo" }, select: { id: true, name: true } });
  if (!org) throw new Error('No organisation with the slug "shogo" here.');
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: org.id } });
  if (!settings) throw new Error("Shogo has no settings row yet; open Settings once first.");

  // Through the same parsers the settings screen saves with, so what lands is
  // exactly what the booking code will read back.
  const services = parseServices(SHOGO_SERVICES);
  const hours = parseBusinessHours(SHOGO_HOURS);
  if (services.length !== SHOGO_SERVICES.length) throw new Error("A service failed validation.");
  if (hours.length !== 7) throw new Error("The opening hours failed validation.");

  const before = parseServices(settings.services);
  console.log(`${apply ? "Applying" : "Preview (nothing is written; add --apply)"}: ${org.name}\n`);
  console.log(`Services: ${before.length} now -> ${services.length}`);
  for (const s of services) {
    const price = s.priceMinor !== null ? `from £${s.priceMinor / 100}` : "no price";
    console.log(`  + ${s.name.padEnd(32)} ${String(s.durationMinutes).padStart(3)} min  ${price}${s.requiresPatchTest ? "  skin test" : ""}`);
  }
  const gone = before.filter((b) => !services.some((s) => s.name.toLowerCase() === b.name.toLowerCase()));
  if (gone.length) console.log(`  - removed: ${gone.map((s) => s.name).join(", ")}`);

  console.log("\nOpening hours:");
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const h = hours.find((x) => x.day === d)!;
    console.log(`  ${DAY[d]}  ${h.closed ? "closed" : `${h.open} to ${h.close}`}`);
  }

  // Stylists: new service names, and no working day the salon is shut.
  const warnings: string[] = [];
  const remapped = parseStylists(settings.teamMembers).map((s) => {
    const { services: next, dropped } = remapStylistServices(s.services);
    if (dropped.length) warnings.push(`${s.name}: no longer listed for ${dropped.join(", ")} (not on the price list)`);
    if (s.services.length > 0 && next.length === 0) {
      // An empty list means "does everything"; never widen someone silently.
      warnings.push(`${s.name}: none of their services are on the new list; left as they were, fix in Settings`);
      return s;
    }
    return { ...s, services: next };
  });
  const team = constrainWorkingDays(remapped, openWeekdays(hours));
  console.log("\nStylists:");
  for (const s of team) {
    const days = s.workingDays.length ? s.workingDays.map((d) => DAY[d]).join(", ") : "any open day";
    console.log(`  ${s.name}: ${days}; ${s.services.length ? s.services.join(", ") : "everything"}`);
  }
  const sunday = team.filter((s) => s.workingDays.length === 0 || s.workingDays.includes(0)).map((s) => s.name);
  console.log(`  Working Sundays: ${sunday.length ? sunday.join(", ") : "nobody yet, so Sundays cannot be booked"}`);

  const currentFaq = parseSalonFaq(settings.salonFaq);
  const writeFaq = !currentFaq;
  console.log(`\nContact number: ${settings.contactPhone ?? "(none)"} -> ${SHOGO_CONTACT_PHONE}`);
  console.log(`Salon FAQs: ${writeFaq ? "filled in from the price list" : "left alone; the salon has written its own"}`);

  const upcoming = await prisma.appointment.count({
    where: {
      organizationId: org.id,
      status: "booked",
      startsAt: { gte: new Date() },
      NOT: { serviceText: { in: services.map((s) => s.name) } },
    },
  });
  if (upcoming) warnings.push(`${upcoming} upcoming appointment(s) keep an old service name; they stay as booked`);

  if (warnings.length) console.log(`\nCheck:\n${warnings.map((w) => `  ! ${w}`).join("\n")}`);

  if (!apply) return;
  await prisma.organizationSettings.update({
    where: { organizationId: org.id },
    data: {
      // Plain JSON, as the settings route stores them.
      services: JSON.parse(JSON.stringify(services)),
      businessHours: JSON.parse(JSON.stringify(hours)),
      teamMembers: JSON.parse(JSON.stringify(team)),
      contactPhone: SHOGO_CONTACT_PHONE,
      ...(writeFaq ? { salonFaq: SHOGO_FAQ } : {}),
    },
  });
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
