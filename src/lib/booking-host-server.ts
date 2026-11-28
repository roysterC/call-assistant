import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import {
  bookingOrigin,
  isBookingHost,
  requestHostname,
  salonDomain,
  salonFromHost,
  salonOrigin,
  salonUrls,
} from "@/lib/booking-host";

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

/**
 * A salon that has its own address (<slug>.getkikai.com) and was opened
 * anywhere else (book.getkikai.com/<slug>, the app's /s/<slug>): on to its
 * own address, keeping the query. Called by its pages only once the salon
 * is known to exist, so a typo or a salon that is not online gets "not
 * found" where it was asked for, never a redirect to a name that has no
 * certificate. Returns when there is nowhere better to go.
 */
export async function sendToOwnAddress(slug: string, path: "/" | "/book", query: Record<string, string | null> = {}) {
  const domain = salonDomain();
  const own = salonOrigin(slug, domain);
  if (!own) return;
  const host = requestHostname(await headers(), "");
  if (salonFromHost(host, domain) === slug) return;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const search = q.toString();
  permanentRedirect(`${own}${path}${search ? `?${search}` : ""}`);
}
