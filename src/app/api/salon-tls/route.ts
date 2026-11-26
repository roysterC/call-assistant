import { NextRequest, NextResponse } from "next/server";
import { salonDomain, salonFromHost } from "@/lib/booking-host";
import { loadOnlineSalon } from "@/lib/online-booking";

/**
 * Caddy's question before it fetches a certificate for a name it has not
 * seen (on_demand_tls "ask", README "Salons' pages"): is
 * maison-nails.getkikai.com a salon's page? 200 yes, 404 no.
 *
 * Without it, anyone could make Caddy request certificates for any name
 * under *.getkikai.com and run into Let's Encrypt's rate limits. It says no
 * more than the page itself would: whether the salon is there.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  const slug = salonFromHost(name, salonDomain());
  if (!slug || !(await loadOnlineSalon(slug))) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, { status: 200 });
}
