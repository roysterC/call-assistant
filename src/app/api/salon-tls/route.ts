import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestHostname, salonDomain, salonFromHost } from "@/lib/booking-host";
import { onlineSalonWhere } from "@/lib/online-booking";

/**
 * Caddy's question before it fetches a certificate for a name it has not
 * seen (on_demand_tls "ask", README "Salons' pages"): is
 * maison-nails.getkikai.com a salon's page? 200 yes, 404 no.
 *
 * Without it, anyone could make Caddy request certificates for any name
 * under *.getkikai.com and run into Let's Encrypt's rate limits. Yes exactly
 * where the page itself would answer (the salon is switched on and online
 * booking is on, as loadOnlineSalon decides), so it tells nobody anything
 * the page doesn't.
 *
 * Caddy asks over 127.0.0.1. A request that came in through Caddy is named
 * after the address it was sent to, so it is refused before the database
 * is touched. The name is the request's own say-so, so this sheds load
 * rather than keeping anything secret: the answer is public anyway.
 */
export const dynamic = "force-dynamic";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function GET(req: NextRequest) {
  if (!LOOPBACK.has(requestHostname(req.headers, req.nextUrl.hostname))) {
    return new NextResponse(null, { status: 404 });
  }
  const name = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  const slug = salonFromHost(name, salonDomain());
  if (!slug) return new NextResponse(null, { status: 404 });
  const online = await prisma.organization.findFirst({ where: onlineSalonWhere(slug), select: { id: true } });
  return new NextResponse(null, { status: online ? 200 : 404 });
}
