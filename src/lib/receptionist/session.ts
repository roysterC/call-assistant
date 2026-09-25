/**
 * A receptionist wired to one salon: its settings, its diary, its tools.
 *
 * Everything salon-specific is read once, when the call starts, so the
 * instructions and tool list are byte-identical for every turn of the call and
 * the prompt cache holds. A salon editing its hours mid-call gets them on the
 * next call, which is the same thing the Vapi sync does.
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getSalonConfig, selectProvider } from "@/lib/booking";
import { buildVoiceTools } from "@/lib/vapi-assistant";
import { executeVapiFunction, isVapiFunctionName } from "@/lib/vapi-functions";
import { ReceptionistEngine, type StreamingClient } from "./engine";
import { buildSystem, greetingFor } from "./prompt";
import { toClaudeTools, withCallerContext } from "./tools";

/**
 * Claude Haiku 4.5 by default: a receptionist's turns are short and the rules
 * that matter are enforced by the booking code, so speed is what the caller
 * notices. One setting, so a bigger model can be tried against the same
 * scripted calls without touching code.
 */
export const DEFAULT_RECEPTIONIST_MODEL = "claude-haiku-4-5";

export function receptionistModel(): string {
  return process.env.RECEPTIONIST_MODEL?.trim() || DEFAULT_RECEPTIONIST_MODEL;
}

export interface ReceptionistSession {
  engine: ReceptionistEngine;
  greeting: string;
  model: string;
  toolNames: string[];
}

export async function startReceptionist(
  organizationId: string,
  opts: { callerNumber: string | null; client?: StreamingClient; now?: Date }
): Promise<ReceptionistSession> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { businessName: true, voiceSystemPrompt: true },
  });
  const cfg = await getSalonConfig(organizationId);
  const caps = selectProvider(cfg).capabilities;
  const tools = toClaudeTools(buildVoiceTools(caps));
  const allowed = new Set(tools.map((t) => t.name));
  const businessName = settings?.businessName ?? "";

  const engine = new ReceptionistEngine({
    client: opts.client ?? new Anthropic(),
    model: receptionistModel(),
    system: buildSystem(
      cfg,
      businessName,
      settings?.voiceSystemPrompt ?? null,
      opts.now ?? new Date(),
      opts.callerNumber
    ),
    tools,
    // Only the tools this salon was given. The model cannot name its way
    // into one it was not offered.
    execute: async (name, input) => {
      if (!allowed.has(name) || !isVapiFunctionName(name)) {
        return { error: `There is no tool called ${name}.` };
      }
      return executeVapiFunction(name, organizationId, withCallerContext(name, input, opts.callerNumber));
    },
  });

  // The call opens with the greeting already said. The API wants the
  // conversation to start with a user turn, so the connection stands in.
  const greeting = greetingFor(businessName);
  engine.messages.push(
    { role: "user", content: "[The call has connected.]" },
    { role: "assistant", content: greeting }
  );

  return { engine, greeting, model: receptionistModel(), toolNames: [...allowed] };
}
