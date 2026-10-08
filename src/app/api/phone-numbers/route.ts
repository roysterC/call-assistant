import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { parsePagination } from "@/lib/pagination";

/**
 * Tenant-scoped, read-only list of phone numbers owned by the caller's org.
 *
 * Super-admins can scope to a different org via `?asOrg=<id>` (handled inside
 * requireTenant). Optional `?channel=whatsapp|vapi` filter.
 *
 * Internal provider IDs (vapiPhoneNumberId, whatsappPhoneNumberId) are never
 * exposed here — those live on the super-admin admin route.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const channelParam = req.nextUrl.searchParams.get("channel");
    const channel =
      channelParam === "whatsapp" || channelParam === "vapi"
        ? channelParam
        : undefined;

    const { take, skip } = parsePagination(req.nextUrl.searchParams);
    const where = {
      organizationId: ctx.organizationId,
      ...(channel ? { channel } : {}),
    };

    const [numbers, total] = await Promise.all([
      prisma.phoneNumber.findMany({
        where,
        select: {
          id: true,
          number: true,
          channel: true,
          label: true,
          active: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.phoneNumber.count({ where }),
    ]);

    return NextResponse.json({
      phoneNumbers: numbers,
      total,
      limit: take,
      offset: skip,
    });
  } catch (error) {
    console.error("[PHONE NUMBERS API] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
