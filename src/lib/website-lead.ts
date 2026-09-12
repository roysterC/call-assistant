import { prisma } from "@/lib/prisma";

/**
 * Create or update the lead behind a website conversation, keyed on email.
 *
 * The website channel used to deduplicate on phone like the voice channels do,
 * which was wrong in both directions. Two people sharing a number — a
 * reception line, a couple, a workshop — merged into one lead and overwrote
 * each other. And a visitor with no number at all got a synthesised
 * `website-{sessionId}`, so the same person returning tomorrow, with a new
 * session, became a second lead.
 *
 * Email is what this channel actually knows: the lead marker cannot fire
 * without one and the capture form requires one.
 */
export async function upsertWebsiteLead(opts: {
  organizationId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
  /** Replaces any existing summary — it is what they want *now*. */
  issue?: string | null;
  notes?: string | null;
}): Promise<{ id: string }> {
  const { organizationId } = opts;
  // Lower-cased so "Sam@x.co.uk" and "sam@x.co.uk" are one person. Without
  // this the unique index treats them as two, which is the same duplication
  // the change is meant to remove.
  const email = opts.email.trim().toLowerCase();
  const name = opts.name?.trim() || null;
  const company = opts.company?.trim() || null;
  const issue = opts.issue?.trim().slice(0, 500) || null;
  const notes = opts.notes?.trim() || null;

  const existing = await prisma.lead.findUnique({
    where: { organizationId_email: { organizationId, email } },
  });

  /*
   * Only claim the phone number if no *other* lead already holds it.
   *
   * Phone is still unique per organisation, for the voice channels' benefit.
   * Writing one blindly here would throw the moment a visitor typed a number
   * that already belonged to someone else — precisely the collision this
   * function exists to stop, turned into a 500 instead of a merge.
   */
  const wanted = opts.phone?.trim() || null;
  let phone: string | null = existing?.phone ?? null;
  if (wanted && wanted !== phone) {
    const holder = await prisma.lead.findUnique({
      where: { organizationId_phone: { organizationId, phone: wanted } },
      select: { id: true },
    });
    if (!holder || holder.id === existing?.id) phone = wanted;
  }

  if (existing) {
    return prisma.lead.update({
      where: { id: existing.id },
      data: {
        // Identity fields fill gaps but never overwrite: a later "Tom" must
        // not replace the "Tom Reid" already on file.
        name: existing.name || name,
        company: existing.company || company,
        phone,
        // The issue is not identity — it is what they want now, so a newer
        // summary replaces an older one. An empty one leaves what is there.
        issue: issue || existing.issue,
        notes: existing.notes || notes,
      },
      select: { id: true },
    });
  }

  return prisma.lead.create({
    data: {
      organizationId,
      email,
      name,
      phone,
      company,
      issue,
      notes,
      source: "website",
    },
    select: { id: true },
  });
}
