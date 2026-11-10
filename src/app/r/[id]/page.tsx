import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseTimezone } from "@/lib/business-hours";
import { textRecipient } from "@/lib/client-link";
import { bookingChatFor, chatLink, chatMessage, fullWhen, offerStillOpen } from "@/lib/rebook";
import { InstagramBooking, LinkPage } from "@/components/rebook/link-page";

/**
 * The link in a rebooking text (src/lib/rebook.ts). WhatsApp opens straight
 * into the salon's chat with the message written; Instagram cannot be given
 * one, so this page shows it with a button that copies it and opens the
 * chat. Either way the booking chat takes it from there.
 */
export const metadata: Metadata = {
  title: "Book your next visit",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function RebookLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const text = await prisma.rebookText.findUnique({ where: { id } });
  if (!text) {
    return (
      <LinkPage title="This link has expired">
        <p>Message or ring the salon to book.</p>
      </LinkPage>
    );
  }

  const [settings, lead, chat] = await Promise.all([
    prisma.organizationSettings.findUnique({
      where: { organizationId: text.organizationId },
      select: { businessName: true, contactPhone: true, timezone: true },
    }),
    prisma.lead.findUnique({
      where: { id: text.leadId },
      select: { name: true, phone: true, contactLead: { select: { name: true, phone: true } } },
    }),
    bookingChatFor(text.organizationId),
  ]);
  const businessName = settings?.businessName || "the salon";

  if (!text.openedAt) {
    await prisma.rebookText.update({ where: { id }, data: { openedAt: new Date() } }).catch(() => {});
  }

  if (!chat) {
    return (
      <LinkPage title={businessName}>
        <p>Booking by message is not open just now.</p>
        {settings?.contactPhone && (
          <p>
            Ring us on <a className="font-medium underline" href={`tel:${settings.contactPhone}`}>{settings.contactPhone}</a> to book.
          </p>
        )}
      </LinkPage>
    );
  }

  // The time offered, while it is still ahead; otherwise they are asked for one.
  const tz = parseTimezone(settings?.timezone);
  const slot = offerStillOpen(text.slotStartsAt);
  const who = lead ? textRecipient(lead) : null;
  const message = chatMessage({
    firstName: who?.greet ? who.greet.trim().split(/\s+/)[0] : null,
    forName: who?.forName ?? null,
    service: text.service,
    whenText: slot ? fullWhen(slot, tz) : null,
    stylist: slot ? text.stylist : null,
  });

  if (chat.kind === "whatsapp") redirect(chatLink(chat, message));

  return (
    <InstagramBooking
      businessName={businessName}
      username={chat.username}
      link={chatLink(chat, message)}
      message={message}
      contactPhone={settings?.contactPhone ?? null}
    />
  );
}
