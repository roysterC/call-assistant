import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { LinkPage } from "@/components/rebook/link-page";

/**
 * "Stop these" from a rebooking text. A button rather than stopping on the
 * visit, because phones and chat apps open links by themselves to draw a
 * preview, and that must not take someone off the list.
 */
export const metadata: Metadata = {
  title: "Stop rebooking texts",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function StopRebookTexts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const text = await prisma.rebookText.findUnique({ where: { id }, select: { organizationId: true, leadId: true } });
  if (!text) {
    return (
      <LinkPage title="This link has expired">
        <p>Reply to the salon, or ring them, and they will take you off the list.</p>
      </LinkPage>
    );
  }
  const [settings, lead] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId: text.organizationId }, select: { businessName: true } }),
    prisma.lead.findUnique({ where: { id: text.leadId }, select: { rebookTextsOff: true } }),
  ]);
  const businessName = settings?.businessName || "the salon";

  if (lead?.rebookTextsOff) {
    return (
      <LinkPage title="Done">
        <p>{businessName} will not text you about rebooking again.</p>
        <p>You will still get texts about appointments you book.</p>
      </LinkPage>
    );
  }

  return (
    <LinkPage title="Stop rebooking texts?">
      <p>{businessName} will stop texting you when you are due back.</p>
      <p>You will still get texts about appointments you book.</p>
      <form method="post" action="/api/rebook/stop" className="pt-2">
        <input type="hidden" name="id" value={id} />
        <Button type="submit" className="w-full">Stop these texts</Button>
      </form>
    </LinkPage>
  );
}
