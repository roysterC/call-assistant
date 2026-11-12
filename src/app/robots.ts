import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { bookingOrigin, isBookingHost, requestHostname } from "@/lib/booking-host";

/**
 * Search engines have no business in a CRM. Only the legal pages may be
 * crawled (Meta's app review and anyone checking the policies read them);
 * everything else, the in-person funnel included, is off limits.
 *
 * The booking address (BOOKING_URL, src/lib/booking-host.ts) is the
 * opposite: it holds nothing but salons' public pages, which salons want
 * found. Read per request, since one app answers on both addresses.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = bookingOrigin();
  if (origin && isBookingHost(requestHostname(await headers(), ""), origin)) {
    return {
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/embed/"] },
    };
  }
  return {
    rules: {
      userAgent: "*",
      allow: ["/privacy-policy", "/terms-of-service", "/data-deletion"],
      disallow: "/",
    },
  };
}
