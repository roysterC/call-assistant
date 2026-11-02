import { PHONE_CHANNELS } from "@/lib/phone-channels";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id: organizationId } = await params;
    const numbers = await prisma.phoneNumber.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ phoneNumbers: numbers });
  } catch (error) {
    console.error("[ADMIN PHONE] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id: organizationId } = await params;
    const body = await req.json();
    const { number, channel, whatsappPhoneNumberId, label } = body;

    if (!number || !channel) {
      return NextResponse.json(
        { error: "number and channel are required" },
        { status: 400 }
      );
    }

    if (!(PHONE_CHANNELS as readonly string[]).includes(channel)) {
      return NextResponse.json(
        { error: `channel must be one of ${PHONE_CHANNELS.join(", ")}` },
        { status: 400 }
      );
    }

    const phone = await prisma.phoneNumber.create({
      data: {
        organizationId,
        number,
        channel,
        whatsappPhoneNumberId: whatsappPhoneNumberId || null,
        label: label || null,
      },
    });

    return NextResponse.json(phone);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Phone number already registered" },
        { status: 409 }
      );
    }
    console.error("[ADMIN PHONE] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
