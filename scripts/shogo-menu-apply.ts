/**
 * Put Shogo's official price list (scripts/shogo-menu.ts) on a database:
 * services and prices, opening hours, the salon's number, and the notes on
 * the list as the Salon FAQs.
 *
 * Replaces the service list outright. Stylists who only do some services have
 * their lists moved onto the new names (OLD_TO_NEW); anything with no new
 * equivalent is dropped and reported. The Salon FAQs are only written if the
 * salon has not written its own. Appointments already in the diary keep the
 * service name they were booked with.
 *
 * Used two ways: by scripts/apply-shogo-menu.ts by hand, and by
 * scripts/post-deploy.ts on the deploy. Either way, applying it records
 * SHOGO_MENU_MIGRATION in ca_data_migrations, and the deploy never applies it
 * again after that, so the salon's own edits in Settings are never
 * overwritten. (It used to guess "already applied" from the service names,
 * and the old list's "Olaplex treatment", on the new list too, fooled it.)
 */

import type { PrismaClient } from "../src/generated/prisma/client";
import { openWeekdays, parseBusinessHours } from "../src/lib/business-hours";
import { constrainWorkingDays, parseServices, parseStylists } from "../src/lib/salon-config";
import { parseSalonFaq } from "../src/lib/salon-knowledge";
import { remapStylistServices, SHOGO_CONTACT_PHONE, SHOGO_FAQ, SHOGO_HOURS, SHOGO_SERVICES } from "./shogo-menu";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The record that says the price list went in. */
export const SHOGO_MENU_MIGRATION = "2026-09-shogo-price-list";

/**
 * Shogo's organisation. The slug is typed by hand in Admin, so it is found by
 * slug or by name, and only when exactly one organisation answers to it.
 */
async function findShogo(prisma: PrismaClient): Promise<{ id: string; name: string } | string> {
  const bySlug = await prisma.organization.findUnique({ where: { slug: "shogo" }, select: { id: true, name: true } });
  if (bySlug) return bySlug;
  const byName = await prisma.organization.findMany({
    where: {
      OR: [
        { name: { equals: "Shogo", mode: "insensitive" } },
        { settings: { businessName: { equals: "Shogo", mode: "insensitive" } } },
      ],
    },
    select: { id: true, name: true, slug: true },
  });
  if (byName.length === 1) return byName[0];
  return byName.length === 0
    ? 'no organisation has the slug "shogo" or the name "Shogo"'
    : `${byName.length} organisations are called Shogo (${byName.map((o) => o.slug).join(", ")}); run it by hand`;
}

export async function applyShogoMenu(
  prisma: PrismaClient,
  opts: { apply: boolean }
): Promise<{ result: "applied" | "previewed" } | { result: "not-found"; reason: string }> {
  const { apply } = opts;
  const found = await findShogo(prisma);
  if (typeof found === "string") return { result: "not-found", reason: found };
  const org = found;
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: org.id } });
  if (!settings) return { result: "not-found", reason: `${org.name} has no settings yet; open Settings once first` };

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

  if (!apply) return { result: "previewed" };
  // Together, so it is never recorded as done without having been done.
  await prisma.$transaction([
    prisma.organizationSettings.update({
      where: { organizationId: org.id },
      data: {
        // Plain JSON, as the settings route stores them.
        services: JSON.parse(JSON.stringify(services)),
        businessHours: JSON.parse(JSON.stringify(hours)),
        teamMembers: JSON.parse(JSON.stringify(team)),
        contactPhone: SHOGO_CONTACT_PHONE,
        ...(writeFaq ? { salonFaq: SHOGO_FAQ } : {}),
      },
    }),
    prisma.dataMigration.upsert({
      where: { id: SHOGO_MENU_MIGRATION },
      update: {},
      create: { id: SHOGO_MENU_MIGRATION },
    }),
  ]);
  console.log("\nDone.");
  return { result: "applied" };
}

