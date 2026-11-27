import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { loadPrices } from "@/lib/plan-access";
import { PRICE_KEYS, type PriceKey } from "@/lib/plan";

/** Kikai's prices (src/lib/plan.ts): the base, each extra team member, and each add-on. */
export async function GET() {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { prices, rows } = await loadPrices();
  return NextResponse.json({ prices, rows });
}

/**
 * Set one price: { key, pence }, pence a month with VAT. An add-on's pence
 * null takes it off sale (salons that have it keep it). The base and seat
 * prices cannot be cleared, only changed.
 */
export async function PUT(req: NextRequest) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const body = (await req.json().catch(() => null)) as { key?: unknown; pence?: unknown } | null;
  const key = body?.key;
  if (typeof key !== "string" || !(PRICE_KEYS as readonly string[]).includes(key)) {
    return NextResponse.json({ error: "Unknown price." }, { status: 400 });
  }
  const pence = body?.pence;
  if (pence === null) {
    if (key === "base" || key === "seat") {
      return NextResponse.json({ error: "The plan and team member prices can be changed, not removed." }, { status: 400 });
    }
    await prisma.billingPrice.deleteMany({ where: { key } });
  } else {
    if (typeof pence !== "number" || !Number.isInteger(pence) || pence < 0 || pence > 1_000_000) {
      return NextResponse.json({ error: "A price is a whole number of pence, from 0 to £10,000." }, { status: 400 });
    }
    // A new amount is a new Stripe Price, made when it is first billed.
    const was = await prisma.billingPrice.findUnique({ where: { key } });
    await prisma.billingPrice.upsert({
      where: { key },
      create: { key, pence },
      update: { pence, ...(was && was.pence !== pence ? { stripePriceId: null } : {}) },
    });
  }
  const { prices, rows } = await loadPrices();
  return NextResponse.json({ prices, rows, key: key as PriceKey });
}
