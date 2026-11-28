import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { loadOnlineSalon } from "@/lib/online-booking";
import { CREAM } from "@/components/online-booking/fonts";
import { SalonSite } from "@/components/online-booking/salon-site";
import { salonUrlsHere, sendToOwnAddress } from "@/lib/booking-host-server";
import { salonChatSiteId } from "@/lib/salon-chat";
import { designChatsFor } from "@/lib/receptionist/design-chats";
import { designMessageLink } from "@/lib/online-booking/salon-page";

/**
 * A salon's own website, built from its CRM settings (src/lib/online-booking).
 * Only there once the salon has switched on online booking in Settings.
 */
export const dynamic = "force-dynamic";
/** The phone's own bar above the page in the page's cream, not the app's green. */
export const viewport: Viewport = { themeColor: CREAM };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const online = await loadOnlineSalon(slug);
  if (!online) return { title: "Not found", robots: { index: false } };
  const { salon } = online;
  const urls = await salonUrlsHere(salon.slug);
  return {
    title: salon.name,
    description: salon.headline ?? salon.about ?? `Book online with ${salon.name}.`,
    // One address for search engines, the booking one where there is one.
    ...(urls.absoluteHome ? { alternates: { canonical: urls.absoluteHome } } : {}),
  };
}

export default async function SalonPage({ params, searchParams }: Props) {
  const [{ slug }, q] = await Promise.all([params, searchParams]);
  const online = await loadOnlineSalon(slug);
  if (!online) notFound();
  await sendToOwnAddress(online.salon.slug, "/", q);

  const [urls, chat, designChats] = await Promise.all([
    salonUrlsHere(online.salon.slug),
    salonChatSiteId(online.organizationId),
    designChatsFor(online.organizationId).catch(() => null),
  ]);
  return (
    <>
      <SalonSite
        salon={online.salon}
        takesBookings={online.takesBookings}
        bookPath={urls.book}
        messageUs={designMessageLink(designChats)}
      />
      {/*
        The salon's chat (src/lib/salon-chat.ts), from this same address so
        the booking address serves it too. Its button opens booking; on a
        phone it sits above the page's own "Book" bar.
      */}
      {chat && (
        <script
          src="/widget.js"
          async
          data-site-id={chat}
          {...(online.takesBookings ? { "data-cta-url": urls.book, "data-cta-label": "Book online" } : {})}
          data-mobile-bottom={online.takesBookings ? "104" : undefined}
        />
      )}
    </>
  );
}
