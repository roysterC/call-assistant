import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadOnlineSalon } from "@/lib/online-booking";
import { BookingFlow } from "@/components/online-booking/booking-flow";

/**
 * Book online with a salon, on its own site. ?service= opens on the times for
 * that service; ?start= (with ?service=) on the last step.
 */
export const dynamic = "force-dynamic";

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
  return (
    <BookingFlow
      salon={online.salon}
      takesBookings={online.takesBookings}
      mode="page"
      initialService={one(q.service)}
      initialStylist={one(q.stylist)}
      initialStart={one(q.start)}
      homeHref={`/s/${online.salon.slug}`}
    />
  );
}
