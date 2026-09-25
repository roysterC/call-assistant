/**
 * Data backfills that follow a schema push. Run by the deploy after the
 * service restarts; safe to run any number of times.
 *
 * After the restart rather than before: until then the old build is still
 * serving, and anything it writes in the meantime (a lead with only a `name`,
 * an appointment with no number) would be written after a backfill that ran
 * earlier and so be missed. Once the new build is live every write fills these
 * itself, so this only ever has the stragglers to do.
 *
 * Usage: npx tsx scripts/post-deploy.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { splitName } from "../src/lib/client-name";

const BATCH = 500;

async function splitLeadNames(prisma: PrismaClient): Promise<number> {
  let done = 0;
  for (;;) {
    const leads = await prisma.lead.findMany({
      where: { name: { not: null }, firstName: null, lastName: null },
      select: { id: true, name: true },
      take: BATCH,
    });
    if (leads.length === 0) return done;
    for (const lead of leads) {
      const parts = splitName(lead.name);
      // A name of only whitespace splits to nothing; mark it with an empty
      // first name so the next pass does not pick the same row up forever.
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          firstName: parts.firstName ?? "",
          lastName: parts.lastName,
        },
      });
    }
    done += leads.length;
  }
}

/**
 * Number appointments written before numbering existed, oldest first, from
 * the same counter live bookings use — so a booking taken while this runs
 * still cannot collide with one numbered here.
 */
async function numberAppointments(prisma: PrismaClient): Promise<number> {
  let done = 0;
  for (;;) {
    const rows = await prisma.appointment.findMany({
      where: { bookingNumber: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, organizationId: true },
      take: BATCH,
    });
    if (rows.length === 0) return done;
    for (const row of rows) {
      await prisma.$transaction(async (tx) => {
        const org = await tx.organization.update({
          where: { id: row.organizationId },
          data: { nextBookingNumber: { increment: 1 } },
          select: { nextBookingNumber: true },
        });
        await tx.appointment.update({
          where: { id: row.id },
          data: { bookingNumber: org.nextBookingNumber - 1 },
        });
      });
    }
    done += rows.length;
  }
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const names = await splitLeadNames(prisma);
    console.log(`  ✓ Client names split: ${names}`);
    const numbers = await numberAppointments(prisma);
    console.log(`  ✓ Appointments numbered: ${numbers}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
