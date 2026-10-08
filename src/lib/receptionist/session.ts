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
import { executeVapiFunction, handleBookAppointment, isVapiFunctionName, normaliseParameters } from "@/lib/vapi-functions";
import { ReadBackGate } from "./read-back";
import { END_CALL_TOOL, ReceptionistEngine, type StreamingClient } from "./engine";
import { buildSystem, greetingFor } from "./prompt";
import { toClaudeTools, withCallerContext } from "./tools";
import { salonKeyterms } from "./voice/keyterms";

/**
 * Claude Haiku 5.5 by default: a receptionist's turns are short and the rules
 * that matter are enforced by the booking code, so speed is what the caller
 * notices. One setting, so a bigger model can be tried against the same
 * scripted calls without touching code.
 */
export const DEFAULT_RECEPTIONIST_MODEL = "claude-haiku-5-5";

export function receptionistModel(): string {
  return process.env.RECEPTIONIST_MODEL?.trim() || DEFAULT_RECEPTIONIST_MODEL;
}

export type ReceptionistRequestOptions = Pick<Anthropic.MessageCreateParams, "thinking" | "output_config">;

const EFFORTS = ["low", "medium", "high"] as const;

/**
 * What a model needs sent alongside it. They are not interchangeable: Haiku
 * 4.5 rejects `output_config.effort` (400), and Haiku 5.5 thinks before every
 * reply unless told not to.
 *
 * On Haiku 5.5 thinking is off. On a phone line the pause before the first
 * word is what the caller hears, thinking comes before any of it, and Haiku
 * 4.5 — what the prompts and scripted calls were tuned on — never thought.
 * Effort stays at the model's own default, medium, unless
 * RECEPTIONIST_EFFORT says otherwise; with thinking off only low, medium and
 * high are accepted.
 */
export function receptionistRequestOptions(model: string): ReceptionistRequestOptions {
  if (model !== "claude-haiku-5-5") return {};
  const asked = process.env.RECEPTIONIST_EFFORT?.trim().toLowerCase();
  const effort = EFFORTS.find((e) => e === asked) ?? "medium";
  return { thinking: { type: "disabled" }, output_config: { effort } };
}

export interface ReceptionistSession {
  engine: ReceptionistEngine;
  greeting: string;
  model: string;
  toolNames: string[];
  /** Whose Anthropic key the call is charged to. */
  keySource: "salon" | "shared";
  /** The salon's own words for the recogniser to listen for. */
  keyterms: string[];
}

/**
 * The Anthropic key a salon's receptionist runs on: its own, when one is set
 * on the organisation (Admin → Organizations → Anthropic API key override), so
 * its usage is billed separately; otherwise the shared key. Null when neither
 * exists. The same override the website chat already honours.
 */
export async function receptionistApiKey(
  organizationId: string
): Promise<{ apiKey: string; source: "salon" | "shared" } | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { anthropicApiKeyOverride: true },
  });
  const own = org?.anthropicApiKeyOverride?.trim();
  if (own) return { apiKey: own, source: "salon" };
  const shared = process.env.ANTHROPIC_API_KEY?.trim();
  return shared ? { apiKey: shared, source: "shared" } : null;
}

export async function startReceptionist(
  organizationId: string,
  opts: { callerNumber: string | null; client?: StreamingClient; now?: Date }
): Promise<ReceptionistSession> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { businessName: true, voiceSystemPrompt: true, salonFaq: true },
  });
  const key = opts.client ? null : await receptionistApiKey(organizationId);
  if (!opts.client && !key) {
    throw new Error("No Anthropic API key: neither this salon's own nor the shared one is set.");
  }
  const cfg = await getSalonConfig(organizationId);
  const caps = selectProvider(cfg).capabilities;
  const tools = toClaudeTools(buildVoiceTools(caps, { ownLine: true }));
  const allowed = new Set(tools.map((t) => t.name));
  const businessName = settings?.businessName ?? "";

  // Bookings are read back before they are made: see read-back.ts.
  const readBack = new ReadBackGate({
    turn: () => engine.turns,
    check: (input) =>
      handleBookAppointment(
        organizationId,
        // Tidied as executeVapiFunction tidies the real booking's input.
        normaliseParameters(withCallerContext("book_appointment", input, opts.callerNumber)) as Parameters<
          typeof handleBookAppointment
        >[1],
        { dryRun: true }
      ),
    book: (input) =>
      executeVapiFunction("book_appointment", organizationId, withCallerContext("book_appointment", input, opts.callerNumber)),
  });

  const engine: ReceptionistEngine = new ReceptionistEngine({
    client: opts.client ?? new Anthropic({ apiKey: key!.apiKey }),
    model: receptionistModel(),
    request: receptionistRequestOptions(receptionistModel()),
    system: buildSystem(
      cfg,
      businessName,
      settings?.voiceSystemPrompt ?? null,
      opts.now ?? new Date(),
      opts.callerNumber,
      settings?.salonFaq ?? null
    ),
    // Hanging up is the engine's own, not the salon's; it goes last so the
    // salon's tools keep their place in the cached prefix.
    tools: [...tools, END_CALL_TOOL],
    // Only the tools this salon was given. The model cannot name its way
    // into one it was not offered.
    execute: async (name, input) => {
      if (name === "prepare_booking" && allowed.has(name)) return readBack.prepare(input);
      if (name === "book_appointment" && allowed.has(name)) return readBack.book(input);
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

  return {
    engine,
    greeting,
    model: receptionistModel(),
    toolNames: [...allowed, END_CALL_TOOL.name],
    keySource: key?.source ?? "shared",
    keyterms: salonKeyterms({ businessName, stylists: cfg.stylists, services: cfg.services }),
  };
}
