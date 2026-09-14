import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import {
  explainProviderSelection,
  getSalonConfig,
  selectProvider,
} from "@/lib/booking";
import { checkGoogleCalendarAccess } from "@/lib/booking/providers/google";
import { composeVoicePrompt, syncAssistant } from "@/lib/vapi-assistant";
import { prisma } from "@/lib/prisma";

/**
 * GET — preview what a sync would push, plus a calendar health check.
 *
 * The health check is the point. A revoked calendar share or a deleted
 * calendar otherwise fails silently at eleven at night, when nobody is
 * watching and the only symptom is an agent that quietly stops offering times.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id: organizationId } = await params;

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { vapiAssistantId: true, voiceSystemPrompt: true },
    });

    const cfg = await getSalonConfig(organizationId);
    const provider = selectProvider(cfg);
    const composed = composeVoicePrompt(cfg, settings?.voiceSystemPrompt ?? null);

    // Only worth checking when Google is actually the chosen provider —
    // otherwise it would report failures for calendars nobody is using.
    let calendars: Awaited<ReturnType<typeof checkGoogleCalendarAccess>> = [];
    if (provider.id === "google") {
      try {
        calendars = await checkGoogleCalendarAccess(cfg.stylists);
      } catch (err) {
        return NextResponse.json({
          provider: provider.id,
          capabilities: provider.capabilities,
          assistantId: settings?.vapiAssistantId ?? null,
          toolNames: composed.toolNames,
          prompt: composed.prompt,
          warnings: [
            ...composed.warnings,
            `Google credentials failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ],
          calendars: [],
        });
      }
    }

    return NextResponse.json({
      provider: provider.id,
      capabilities: provider.capabilities,
      assistantId: settings?.vapiAssistantId ?? null,
      toolNames: composed.toolNames,
      prompt: composed.prompt,
      warnings: [...composed.warnings, ...explainProviderSelection(cfg)],
      calendars,
    });
  } catch (error) {
    console.error("[ADMIN VAPI SYNC] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST — actually push prompt + tools to the Vapi assistant.
 *
 * Manual on purpose. Syncing automatically on every settings save means a
 * stray edit rewrites a live assistant mid-evening with nobody watching.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id: organizationId } = await params;
    // `?dryRun=1` returns the exact PATCH body without sending it. Worth
    // using once against a live assistant before trusting this with one.
    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const result = await syncAssistant(organizationId, { dryRun });

    // A dry run legitimately reports synced:false; only a real attempt that
    // failed to push is a conflict.
    if (!result.synced && !result.dryRun) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ADMIN VAPI SYNC] POST error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to sync assistant",
      },
      { status: 500 }
    );
  }
}
