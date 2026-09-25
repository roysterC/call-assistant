/**
 * The receptionist's conversation loop: one caller turn in, a spoken reply
 * out, with whatever diary work it takes in between.
 *
 * This is the part Vapi does for us today, minus the audio. It is kept free of
 * the database and of any transport so the same loop serves the typed lab, the
 * browser microphone and the phone line — each of those only decides where the
 * caller's words come from and where the reply's words go.
 *
 * The reply is streamed as it is written, so a voice layer can start speaking
 * the first sentence while the model is still writing the second. Tool calls
 * are announced before they run, so a voice layer can fill the pause ("let me
 * just check") instead of leaving the line silent while the diary is read.
 */

import Anthropic from "@anthropic-ai/sdk";

/** The slice of the SDK client the loop uses, so tests can stand in for it. */
export interface StreamingClient {
  messages: {
    stream(
      params: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal }
    ): {
      on(event: "text", listener: (delta: string) => void): unknown;
      finalMessage(): Promise<Anthropic.Message>;
    };
  };
}

/** Runs one of the salon's tools. Throws only on a bug; business failures are results. */
export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>
) => Promise<unknown>;

export interface TurnHooks {
  /** A fragment of the reply, in order, as the model writes it. */
  onText?: (delta: string) => void;
  /** A tool is about to run. */
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  /** A tool finished; `result` is what the model will see. */
  onToolResult?: (name: string, result: unknown, isError: boolean) => void;
}

export interface EngineConfig {
  client: StreamingClient;
  model: string;
  /** Stable text first (cached), then anything that changes per call. */
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  execute: ToolExecutor;
  /** Model round trips allowed for one caller turn. */
  maxRoundTrips?: number;
  maxTokens?: number;
}

export interface TurnResult {
  /** Everything said to the caller this turn, joined. */
  text: string;
  /** Tools run this turn, in order, for the call log and the lab. */
  tools: Array<{ name: string; input: Record<string, unknown>; result: unknown; isError: boolean }>;
  stopReason: Anthropic.Message["stop_reason"] | "aborted" | "round_trip_limit";
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * Said when the loop cannot finish a turn cleanly. Deliberately a promise to
 * follow up rather than a claim that anything happened: the caller must never
 * be told they are booked because the software lost its way.
 */
export const FALLBACK_REPLY =
  "Sorry, I'm having a little trouble with that. Someone from the salon will ring you back to sort it out.";

export class ReceptionistEngine {
  /**
   * The conversation so far, in the API's own shapes. Appended to, never
   * edited: an earlier turn rewritten is a cache miss on every turn after it.
   */
  readonly messages: Anthropic.MessageParam[] = [];

  constructor(private readonly cfg: EngineConfig) {}

  async respond(
    callerText: string,
    hooks: TurnHooks = {},
    signal?: AbortSignal
  ): Promise<TurnResult> {
    const result: TurnResult = {
      text: "",
      tools: [],
      stopReason: "end_turn",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };

    // Built up during the turn and committed at the end. Only complete
    // exchanges ever go in — an assistant tool call is added together with
    // its results — so wherever the turn stops, the history stays valid.
    const pending: Anthropic.MessageParam[] = [
      { role: "user", content: callerText },
    ];

    // Interrupted (the caller talked over the reply). What they said, and any
    // diary work already done, is kept: a booking that went through before
    // the interruption has to stay in the model's memory, or it will offer to
    // make it again. The history may now end on a user turn; the next caller
    // turn is another user message, which the API joins onto it.
    const aborted = (): TurnResult => {
      this.messages.push(...pending);
      return { ...result, stopReason: "aborted" };
    };

    const say = (delta: string) => {
      result.text += delta;
      hooks.onText?.(delta);
    };

    const limit = this.cfg.maxRoundTrips ?? 6;
    for (let trip = 0; trip < limit; trip++) {
      if (signal?.aborted) return aborted();

      const stream = this.cfg.client.messages.stream(
        {
          model: this.cfg.model,
          max_tokens: this.cfg.maxTokens ?? 2048,
          system: this.cfg.system,
          tools: this.cfg.tools,
          messages: [...this.messages, ...pending],
        },
        { signal }
      );
      stream.on("text", say);

      let message: Anthropic.Message;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        if (signal?.aborted) return aborted();
        throw err;
      }

      result.usage.input += message.usage.input_tokens;
      result.usage.output += message.usage.output_tokens;
      result.usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      result.usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
      result.stopReason = message.stop_reason;

      const toolUses = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // Refusal can cut a tool call off part-way; a truncated call can still
      // look valid. Neither is ever run.
      if (
        message.stop_reason === "refusal" ||
        (message.stop_reason === "max_tokens" && toolUses.length > 0)
      ) {
        if (!result.text.trim()) say(FALLBACK_REPLY);
        pending.push({ role: "assistant", content: textOnly(message) || FALLBACK_REPLY });
        this.messages.push(...pending);
        return result;
      }

      pending.push({ role: "assistant", content: message.content });

      if (toolUses.length === 0) {
        this.messages.push(...pending);
        return result;
      }

      // Every tool_use gets a tool_result, all in one message: splitting them
      // or dropping a failed one is a 400 on the next request.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const input = isRecord(use.input) ? use.input : {};
        hooks.onToolStart?.(use.name, input);
        let output: unknown;
        let isError = false;
        try {
          output = await this.cfg.execute(use.name, input);
        } catch (err) {
          isError = true;
          output = { error: "That didn't work on our side.", detail: err instanceof Error ? err.message : String(err) };
        }
        hooks.onToolResult?.(use.name, output, isError);
        result.tools.push({ name: use.name, input, result: output, isError });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(output ?? null),
          ...(isError ? { is_error: true } : {}),
        });
      }
      pending.push({ role: "user", content: results });

      // A reply spoken before the tool call ("let me check") and the one after
      // it are separate sentences to a listener.
      if (result.text && !/\s$/.test(result.text)) say(" ");
    }

    // Still asking for tools after the allowance: something is looping. Close
    // the exchange with a text turn so the history stays valid.
    if (!result.text.trim()) say(FALLBACK_REPLY);
    pending.push({ role: "assistant", content: FALLBACK_REPLY });
    this.messages.push(...pending);
    return { ...result, stopReason: "round_trip_limit" };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function textOnly(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
