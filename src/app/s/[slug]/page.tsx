import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadOnlineSalon, onlineAvailability } from "@/lib/online-booking";
import { SalonSite } from "@/components/online-booking/salon-site";
import { salonUrlsHere } from "@/lib/booking-host-server";
import { salonChatSiteId } from "@/lib/salon-chat";

/**
 * A salon's own website, built from its CRM settings (src/lib/online-booking).
 * Only there once the salon has switched on online booking in Settings.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

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

export default async function SalonPage({ params }: Props) {
  const { slug } = await params;
  const online = await loadOnlineSalon(slug);
  if (!online) notFound();

  // The soonest free time for the first service, for one-tap "Next free".
  // Not colour: a new client would first have to say whether they are new.
  let nextFree = null;
  const first = online.salon.services.find((s) => !s.requiresPatchTest);
  if (online.takesBookings && first) {
    const res = await onlineAvailability(online, { service: first.name }).catch(() => null);
    const day = res?.ok ? res.days.find((d) => d.slots.length > 0) : null;
    if (day) nextFree = { service: first.name, slot: day.slots[0], date: day.date };
  }

  const [urls, chat] = await Promise.all([
    salonUrlsHere(online.salon.slug),
    salonChatSiteId(online.organizationId),
  ]);
  return (
    <>
      <SalonSite
        salon={online.salon}
        takesBookings={online.takesBookings}
        nextFree={nextFree}
        bookPath={urls.book}
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
