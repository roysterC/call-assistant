import type { Metadata } from "next";
import { LeadFunnel } from "@/components/funnel/lead-funnel";
import { consultationBookingFromEnv } from "@/lib/consultation-link";

/**
 * The in-person lead funnel. Deliberately linked from nowhere: it is opened
 * on a phone or tablet when talking to a salon owner face to face (or from a
 * QR code on the table), and kept out of search engines.
 */
export const metadata: Metadata = {
  title: "Kikai",
  robots: { index: false, follow: false, nocache: true },
};

// The booking link is read on each visit, so changing it needs no rebuild.
export const dynamic = "force-dynamic";

export default async function MeetPage() {
  return <LeadFunnel booking={await consultationBookingFromEnv()} />;
}
