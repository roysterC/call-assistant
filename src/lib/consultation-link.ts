/**
 * The free-consultation booking link the funnel shows, from the server's
 * settings: CONSULTATION_URL (DISCOVERY_CALL_URL, its first name, still
 * works).
 *
 * A Google short link (calendar.app.google/...) refuses to be framed, so it
 * is followed here to the booking page it stands for, and that answer is
 * kept for a few hours rather than asked on every visit.
 */

import { consultationBooking, isGoogleShortLink, type ConsultationBooking } from "@/lib/funnel";

const KEEP_MS = 6 * 60 * 60 * 1000;
const resolved = new Map<string, { at: number; booking: ConsultationBooking | null }>();

/** The full Google booking page a short link leads to, or null. */
export async function followGoogleShortLink(
  short: string,
  fetcher: typeof fetch = fetch
): Promise<ConsultationBooking | null> {
  try {
    const res = await fetcher(short, { redirect: "follow", signal: AbortSignal.timeout(5000) });
    // A plain redirect lands on the booking page itself...
    const landed = consultationBooking(res.url);
    if (landed?.kind === "google") return landed;
    // ...otherwise the link's page names it.
    const body = await res.text();
    const named = body.match(/https:\/\/calendar\.google\.com\/calendar\/[^"'\s<>]*appointments\/schedules\/[A-Za-z0-9_-]+/);
    const booking = consultationBooking(named?.[0]);
    return booking?.kind === "google" ? booking : null;
  } catch {
    return null;
  }
}

export async function consultationBookingFromEnv(
  raw = process.env.CONSULTATION_URL || process.env.DISCOVERY_CALL_URL
): Promise<ConsultationBooking | null> {
  if (!raw?.trim()) return null;
  if (!isGoogleShortLink(raw)) return consultationBooking(raw);

  const kept = resolved.get(raw);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.booking;
  const booking = await followGoogleShortLink(raw.trim());
  if (!booking) {
    console.warn(
      "[FUNNEL] Could not turn the Google short link in CONSULTATION_URL into its booking page; use the booking page's full link (README)."
    );
  }
  resolved.set(raw, { at: Date.now(), booking });
  return booking;
}
