import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
} from "@/lib/password";

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "currentPassword and newPassword required" },
        { status: 400 }
      );
    }

    const validation = validatePassword(newPassword);
    if (validation) {
      return NextResponse.json({ error: validation }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });

    if (!user?.passwordHash) {
      return NextResponse.json(
        { error: "Account not configured for password login" },
        { status: 400 }
      );
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: session.user.id },
      // Choosing their own password is what a temporary one was waiting for.
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ACCOUNT PASSWORD] PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
