import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { requestHostname, servesOnlySalonPages } from "@/lib/booking-host";

/**
 * Search engines have no business in a CRM. Only the legal pages may be
 * crawled (Meta's app review and anyone checking the policies read them);
 * everything else, the in-person funnel included, is off limits.
 *
 * The booking address and salons' own addresses (src/lib/booking-host.ts)
 * are the opposite: they hold nothing but salons' public pages, which salons
 * want found. Read per request, since one app answers on all of them.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (servesOnlySalonPages(requestHostname(await headers(), ""))) {
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
