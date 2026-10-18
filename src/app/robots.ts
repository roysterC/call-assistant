import type { MetadataRoute } from "next";

/**
 * Search engines have no business in a CRM. Only the legal pages may be
 * crawled (Meta's app review and anyone checking the policies read them);
 * everything else, the in-person funnel included, is off limits.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/privacy-policy", "/terms-of-service", "/data-deletion"],
      disallow: "/",
    },
  };
}
