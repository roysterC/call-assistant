import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { loadOnlineSalon } from "@/lib/online-booking";
import { CREAM } from "@/components/online-booking/fonts";
import { BookingFlow } from "@/components/online-booking/booking-flow";
import { salonUrlsHere } from "@/lib/booking-host-server";

/**
 * Book online with a salon, on its own site. ?service= opens on the times for
 * that service; ?start= (with ?service=) on the last step; ?treatment= on
 * choosing among that treatment's services (a tile on the salon's page).
 */
export const dynamic = "force-dynamic";
/** The phone's own bar above the page in the page's cream, not the app's green. */
export const viewport: Viewport = { themeColor: CREAM };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const online = await loadOnlineSalon(slug);
  return online ? { title: `Book · ${online.salon.name}` } : { title: "Not found", robots: { index: false } };
}

export default async function BookPage({ params, searchParams }: Props) {
  const [{ slug }, q] = await Promise.all([params, searchParams]);
  const online = await loadOnlineSalon(slug);
  if (!online) notFound();
  const urls = await salonUrlsHere(online.salon.slug);
  return (
    <BookingFlow
      salon={online.salon}
      takesBookings={online.takesBookings}
      mode="page"
      initialService={one(q.service)}
      initialTreatment={one(q.treatment)}
      initialStylist={one(q.stylist)}
      initialStart={one(q.start)}
      homeHref={urls.home}
    />
  );
}
