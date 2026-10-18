import type { Metadata } from "next";
import { LeadFunnel } from "@/components/funnel/lead-funnel";

/**
 * The in-person lead funnel. Deliberately linked from nowhere: it is opened
 * on a phone or tablet when talking to a salon owner face to face (or from a
 * QR code on the table), and kept out of search engines.
 */
export const metadata: Metadata = {
  title: "Kikai",
  robots: { index: false, follow: false, nocache: true },
};

export default function MeetPage() {
  return <LeadFunnel />;
}
