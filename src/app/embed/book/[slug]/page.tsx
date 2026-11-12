import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadOnlineSalon } from "@/lib/online-booking";
import { BookingFlow } from "@/components/online-booking/booking-flow";

/**
 * The booking flow inside a salon's existing website, loaded by
 * public/book.js (or pasted as an <iframe>). Under /embed so it may be
 * framed by any site (src/lib/security-headers.ts); every other page refuses.
 *
 * ?mode=inline: part of the page, as tall as it needs (it tells book.js its
 * height); otherwise a pop-up over the page, with a close button.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Book online", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function EmbedBookPage({ params, searchParams }: Props) {
  const [{ slug }, q] = await Promise.all([params, searchParams]);
  const online = await loadOnlineSalon(slug);
  if (!online) notFound();
  return (
    <BookingFlow
      salon={online.salon}
      takesBookings={online.takesBookings}
      mode={one(q.mode) === "inline" ? "inline" : "popup"}
      initialService={one(q.service)}
      initialStylist={one(q.stylist)}
    />
  );
}
