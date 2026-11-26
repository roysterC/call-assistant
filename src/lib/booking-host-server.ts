import { headers } from "next/headers";
import { bookingOrigin, isBookingHost, requestHostname, salonDomain, salonFromHost, salonUrls } from "@/lib/booking-host";

/**
 * A salon's page addresses for the request being rendered: / on its own
 * address, /<slug> on the booking address, /s/<slug> otherwise
 * (src/lib/booking-host.ts).
 */
export async function salonUrlsHere(slug: string) {
  const origin = bookingOrigin();
  const domain = salonDomain();
  const host = requestHostname(await headers(), "");
  return salonUrls(slug, {
    origin,
    domain,
    onBookingHost: isBookingHost(host, origin),
    onSalonHost: salonFromHost(host, domain) === slug,
  });
}
