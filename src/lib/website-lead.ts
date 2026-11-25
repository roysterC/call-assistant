import { prisma } from "@/lib/prisma";
import { fillGaps, newClientFromTyped } from "@/lib/client-identity";

/**
 * The client behind a website conversation or form, from what the visitor
 * typed.
 *
 * Nothing the visitor types proves who they are: anyone can give a client's
 * email or number. So the details never find a client on file. A
 * conversation already filed under a client (its own earlier details, or
 * staff filing it) keeps them, and only fills what is missing there; anyone
 * else gets a new card, marked as possibly the client whose email or number
 * they gave, for the salon to merge (src/lib/client-identity.ts).
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
  /** Where a new lead came from; an existing one keeps its own. */
  source?: string;
  /** The client the conversation is already filed under, if any. */
  leadId?: string | null;
}): Promise<{ id: string }> {
  const { organizationId } = opts;

  if (opts.leadId) {
    const current = await prisma.lead.findFirst({
      where: { id: opts.leadId, organizationId, anonymisedAt: null },
      select: { id: true, name: true, email: true, company: true, notes: true },
    });
    if (current) {
      // Never her number, even one she has none of: the conversation being
      // hers does not make every number typed in it hers. It stays on the
      // conversation (visitorPhone), where staff see it beside hers.
      const update = fillGaps(current, opts);
      if (Object.keys(update).length) await prisma.lead.update({ where: { id: current.id }, data: update });
      return { id: current.id };
    }
  }

  const lead = await newClientFromTyped(prisma, organizationId, {
    name: opts.name,
    email: opts.email,
    phone: opts.phone,
    company: opts.company,
    issue: opts.issue,
    notes: opts.notes,
    source: opts.source ?? "website",
  });
  return { id: lead.id };
}
