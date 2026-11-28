import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
 * own address, keeping the whole query (a booking link's ?service=, an
 * Instagram bio's tracking). Called by its pages only once the salon
 * is known to exist, so a typo or a salon that is not online gets "not
 * found" where it was asked for, never a redirect to a name that has no
 * certificate. Returns when there is nowhere better to go.
 */
export async function sendToOwnAddress(
  slug: string,
  path: "/" | "/book",
  query: Record<string, string | string[] | undefined> = {}
) {
  const domain = salonDomain();
  const own = salonOrigin(slug, domain);
  if (!own) return;
  const host = requestHostname(await headers(), "");
  if (salonFromHost(host, domain) === slug) return;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) for (const one of Array.isArray(v) ? v : v !== undefined ? [v] : []) q.append(k, one);
  const search = q.toString();
  // Temporary, not permanent: a browser keeps a 308 for good, and would go
  // on jumping to the salon's address after it stops taking bookings there
  // (where there is then no certificate). The page it lands on names that
  // address as its canonical one, which is what search engines go by.
  redirect(`${own}${path}${search ? `?${search}` : ""}`);
}
