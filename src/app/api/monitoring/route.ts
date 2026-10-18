/**
 * Browser error reports on their way to Sentry. The browser posts here (the
 * `tunnel` in instrumentation-client.ts) rather than to Sentry itself, so the
 * content security policy can keep connections to this site and ad blockers
 * do not swallow them.
 *
 * Public, so it forwards only to our own DSN's project. A report naming any
 * other is dropped, so this cannot be used to send traffic elsewhere.
 * Rate-limited and size-capped like any public endpoint.
 */

import { NextResponse } from "next/server";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

const MAX_BYTES = 512 * 1024;

function ourDsn(): URL | null {
  try {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
    return dsn ? new URL(dsn) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const dsn = ourDsn();
  if (!dsn) return new NextResponse(null, { status: 204 });

  if (!rateLimit("monitoring", clientIpFromHeaders(req.headers), { tokens: 30, refillPerSecond: 0.5 }).allowed) {
    return new NextResponse(null, { status: 429 });
  }

  const body = await req.text();
  if (body.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

  // An envelope's first line is a JSON header naming the DSN it is for.
  let named: URL;
  try {
    named = new URL(JSON.parse(body.split("\n", 1)[0]).dsn);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const project = dsn.pathname.replace(/^\/+|\/+$/g, "");
  if (named.host !== dsn.host || named.pathname.replace(/^\/+|\/+$/g, "") !== project) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const res = await fetch(`${dsn.protocol}//${dsn.host}/api/${project}/envelope/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
    });
    return new NextResponse(null, { status: res.ok ? 200 : 502 });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
