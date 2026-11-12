import { headers } from "next/headers";
import { bookingOrigin, isBookingHost, requestHostname, salonUrls } from "@/lib/booking-host";

/**
 * A salon's page addresses for the request being rendered: /<slug> when it
 * came in on the booking address, /s/<slug> otherwise (src/lib/booking-host.ts).
 */
export async function salonUrlsHere(slug: string) {
  const origin = bookingOrigin();
  const h = await headers();
  return salonUrls(slug, { origin, onBookingHost: isBookingHost(requestHostname(h, ""), origin) });
}
