import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestHostname, salonDomain, salonFromHost } from "@/lib/booking-host";

/**
 * Caddy's question before it fetches a certificate for a name it has not
 * seen (on_demand_tls "ask", README "Salons' pages"): is
 * maison-nails.getkikai.com a salon? 200 yes, 404 no.
 *
 * Without it, anyone could make Caddy request certificates for any name
 * under *.getkikai.com and run into Let's Encrypt's rate limits. Yes for
 * any salon that exists and is switched on, online booking or not, so a
 * salon that has paused it shows its own "not found" page rather than a
 * certificate error.
 *
 * Caddy asks over 127.0.0.1, so only that is answered: from the internet,
 * through Caddy, the request arrives named app.getkikai.com and is refused
 * before the database is touched.
 */
export const dynamic = "force-dynamic";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export async function GET(req: NextRequest) {
  if (!LOOPBACK.has(requestHostname(req.headers, req.nextUrl.hostname))) {
    return new NextResponse(null, { status: 404 });
  }
  const name = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  const slug = salonFromHost(name, salonDomain());
  if (!slug) return new NextResponse(null, { status: 404 });
  const org = await prisma.organization.findUnique({ where: { slug }, select: { enabled: true } });
  return new NextResponse(null, { status: org?.enabled ? 200 : 404 });
}
