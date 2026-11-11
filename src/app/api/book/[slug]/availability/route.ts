import { NextRequest, NextResponse } from "next/server";
import { loadOnlineSalon, onlineAvailability } from "@/lib/online-booking";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * A week of free times for one service, from `from` (YYYY-MM-DD, salon time):
 * GET ?service=Cut&stylist=Jo&from=2026-11-12&newClient=1
 *
 * The same slot engine as the phone receptionist, so the page never offers a
 * time the receptionist would not.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!rateLimit("book-availability", clientIpFromHeaders(req.headers), { tokens: 60, refillPerSecond: 1 }).allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }
  const { slug } = await params;
  const online = await loadOnlineSalon(slug);
  if (!online) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const q = req.nextUrl.searchParams;
  try {
    const res = await onlineAvailability(online, {
      service: q.get("service"),
      stylist: q.get("stylist"),
      from: q.get("from"),
      newClient: q.get("newClient") === "1",
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[ONLINE BOOKING] Availability failed:", err);
    return NextResponse.json({ error: "Could not load times just now. Please try again." }, { status: 502 });
  }
}
