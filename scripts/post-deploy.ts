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
import { applyShogoMenu, SHOGO_MENU_MIGRATION } from "./shogo-menu-apply";

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

/**
 * Logins made from an invite link that Kikai copied were marked as having a
 * confirmed email, though nothing proved the address (it could be made up).
 * Unmarked once; each person can then confirm theirs from Account. Only where
 * the mark is exactly the moment the invite was used, so an address confirmed
 * since, by a reset or the confirm link, is left alone.
 */
const UNVERIFY_LINK_INVITES = "unverify-link-invite-logins-2026-11";

async function unverifyLinkInviteLogins(prisma: PrismaClient): Promise<string> {
  if (await prisma.dataMigration.findUnique({ where: { id: UNVERIFY_LINK_INVITES } })) return "done before, left alone";
  const invites = await prisma.invitation.findMany({
    where: { delivery: "link", acceptedAt: { not: null } },
    select: { email: true, acceptedAt: true },
  });
  let n = 0;
  for (const inv of invites) {
    const r = await prisma.user.updateMany({
      where: { email: inv.email, emailVerified: inv.acceptedAt },
      data: { emailVerified: null },
    });
    n += r.count;
  }
  await prisma.dataMigration.create({ data: { id: UNVERIFY_LINK_INVITES } });
  return `${n} unmarked`;
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
    // The diary became a switch of its own; a salon that has it through the
    // phone or booking by message keeps it if those are switched off.
    const diaries = await prisma.organizationSettings.updateMany({
      where: { diaryEnabled: false, OR: [{ voiceEnabled: true }, { chatBookingEnabled: true }] },
      data: { diaryEnabled: true },
    });
    console.log(`  ✓ Diaries switched on for salons that had one through the phone or messages: ${diaries.count}`);
    console.log(`  ✓ Logins from copied invite links, email no longer counted as confirmed: ${await unverifyLinkInviteLogins(prisma)}`);
    // Shogo's official price list, exactly once: after it is in (here or by
    // hand) it is recorded, and the salon's own edits in Settings are never
    // overwritten. A failure is reported, not fatal: the CRM is already live
    // on the new build.
    try {
      const done = await prisma.dataMigration.findUnique({ where: { id: SHOGO_MENU_MIGRATION } });
      if (done) {
        console.log(`  ✓ Shogo price list: applied ${done.ranAt.toISOString().slice(0, 10)}, left alone`);
      } else {
        const menu = await applyShogoMenu(prisma, { apply: true });
        console.log(
          menu.result === "not-found"
            ? `  ! Shogo price list NOT applied: ${menu.reason}`
            : "  ✓ Shogo price list: applied"
        );
      }
    } catch (err) {
      console.error("  ! Shogo price list NOT applied:", err instanceof Error ? err.message : err);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
