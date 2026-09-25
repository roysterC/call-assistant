/**
 * The salon's tools, in the shape the Claude API takes.
 *
 * Generated from the same capability-driven list the Vapi assistant is given
 * (`buildVoiceTools`), so both receptionists can do exactly the same things and
 * the booking rules behind them are shared, not copied.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { VapiTool } from "@/lib/vapi-assistant";

/**
 * Parameters the model must not be asked for, because the line already knows
 * them. The caller's number is filled in by the session from caller ID; asking
 * the model for it invites a guess.
 */
const SERVER_FILLED = new Set(["callerNumber"]);

export function toClaudeTools(tools: VapiTool[]): Anthropic.Tool[] {
  return tools.map(({ function: fn }) => {
    const params = fn.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const properties = Object.fromEntries(
      Object.entries(params.properties ?? {}).filter(([k]) => !SERVER_FILLED.has(k))
    );
    const required = (params.required ?? []).filter((k) => !SERVER_FILLED.has(k));
    return {
      name: fn.name,
      description: fn.description,
      input_schema: {
        type: "object" as const,
        properties,
        ...(required.length ? { required } : {}),
      },
    };
  });
}

/**
 * Tools that find an existing booking by phone and have no caller-ID fallback
 * of their own. For these a missing number means "the one I'm ringing from".
 */
const LOOKS_UP_BY_PHONE = new Set([
  "find_appointment",
  "cancel_appointment",
  "reschedule_appointment",
]);

/**
 * Tool input as the handlers expect it, with what the line knows filled in.
 *
 * `callerNumber` always comes from caller ID, whatever the model sent.
 *
 * The phone field itself is left alone on the tools that save or book: their
 * handlers already fall back to caller ID when it is blank, and when they do
 * they say so (`usedCallerId`), which is what prompts the receptionist to read
 * the number back to a caller who never said it aloud. Filling it in here
 * would hide that. Only the look-up tools, which have no fallback, get it.
 */
export function withCallerContext(
  toolName: string,
  input: Record<string, unknown>,
  callerNumber: string | null
): Record<string, unknown> {
  if (!callerNumber) return { ...input };
  const out: Record<string, unknown> = { ...input, callerNumber };
  if (LOOKS_UP_BY_PHONE.has(toolName)) {
    const v = out.customerPhone;
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
      out.customerPhone = callerNumber;
    }
  }
  return out;
}
