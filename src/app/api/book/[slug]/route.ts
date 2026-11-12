import { NextRequest, NextResponse } from "next/server";
import { loadOnlineSalon } from "@/lib/online-booking";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * A salon's public booking catalogue: what the booking page shows before a
 * time is chosen. Public, no login: the salon chose to take bookings online
 * (src/lib/online-booking). Nothing private is in it (catalogue.ts).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!rateLimit("book-catalogue", clientIpFromHeaders(req.headers), { tokens: 60, refillPerSecond: 1 }).allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }
  const { slug } = await params;
  const online = await loadOnlineSalon(slug);
  if (!online) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { salon: online.salon, takesBookings: online.takesBookings },
    { headers: { "Cache-Control": "no-store" } }
  );
}
