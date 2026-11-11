import { NextRequest, NextResponse } from "next/server";
import { bookOnline, loadOnlineSalon } from "@/lib/online-booking";
import { normalisePhone } from "@/lib/phone";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * Book a time chosen on the online booking page into the salon's diary.
 *
 * Through the phone receptionist's own booking path (bookOnline), so the
 * same rules, the same locked write and the same confirmation text. Public by
 * design, so it is rate-limited by address and by number, and carries a
 * field no person fills in to catch form-filling bots.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ip = clientIpFromHeaders(req.headers);
  // A handful of tries a minute: enough for "that time has gone, try the
  // next", not enough to fill a diary.
  if (!rateLimit("book-write", ip, { tokens: 6, refillPerSecond: 1 / 20 }).allowed) {
    return NextResponse.json({ error: "Too many bookings from here. Please wait a few minutes." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  // The hidden field: a person never sees it, a bot fills everything.
  if (typeof body.company === "string" && body.company.trim()) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const phone = normalisePhone(typeof body.phone === "string" ? body.phone : "");
  if (phone.ok && !rateLimit("book-write-phone", phone.e164, { tokens: 4, refillPerSecond: 1 / 300 }).allowed) {
    return NextResponse.json({ error: "Too many bookings on this number. Please ring the salon." }, { status: 429 });
  }

  const { slug } = await params;
  const online = await loadOnlineSalon(slug);
  if (!online) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await bookOnline(online, {
      service: body.service,
      start: body.start,
      stylist: body.stylist,
      name: body.name,
      phone: body.phone,
      newClient: body.newClient,
      notes: body.notes,
    });
    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[ONLINE BOOKING] Booking failed:", err);
    const call = online.salon.phone ? ` Please ring the salon on ${online.salon.phone}.` : "";
    return NextResponse.json(
      { ok: false, code: "failed", error: `Sorry, something went wrong and we could not confirm your booking.${call}` },
      { status: 500 }
    );
  }
}
