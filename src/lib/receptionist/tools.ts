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
 * Tool input as the handlers expect it, with what the line knows filled in.
 *
 * `callerNumber` always comes from caller ID, whatever the model sent. The
 * phone field itself is left alone: every handler falls back to caller ID
 * when it is blank, and says so when it does (`usedCallerId`), which is what
 * prompts the receptionist to read the number back to a caller who never
 * said it aloud. Filling it in here would hide that. The look-up tools also
 * compare it with caller ID to tell a client's own booking from someone
 * else's.
 */
export function withCallerContext(
  toolName: string,
  input: Record<string, unknown>,
  callerNumber: string | null
): Record<string, unknown> {
  if (!callerNumber) return { ...input };
  return { ...input, callerNumber };
}
