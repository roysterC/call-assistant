import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { FALLBACK_REPLY, ReceptionistEngine, type StreamingClient, type ToolExecutor } from "./engine";
import { toClaudeTools, withCallerContext } from "./tools";
import { buildSystem, greetingFor } from "./prompt";
import type { SalonConfig } from "@/lib/booking";

// --- A stand-in for the model ------------------------------------------------

type Scripted = {
  text?: string[];
  tools?: Array<{ name: string; input: Record<string, unknown> }>;
  stop?: Anthropic.Message["stop_reason"];
};

function message(s: Scripted, n: number): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [];
  if (s.text?.length) content.push({ type: "text", text: s.text.join(""), citations: null } as Anthropic.TextBlock);
  s.tools?.forEach((t, i) =>
    content.push({ type: "tool_use", id: `tu_${n}_${i}`, name: t.name, input: t.input } as Anthropic.ToolUseBlock)
  );
  return {
    id: `msg_${n}`,
    type: "message",
    role: "assistant",
    model: "test",
    content,
    stop_reason: s.stop ?? (s.tools?.length ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/** Plays the script one reply per request, recording what was sent. */
function fakeClient(script: Scripted[], opts: { hangOn?: number } = {}) {
  const sent: Anthropic.MessageStreamParams[] = [];
  let n = 0;
  const client: StreamingClient = {
    messages: {
      stream(params, options) {
        // Copied: the engine passes a fresh array each time, but be sure the
        // record is of what was sent then, not of what it became.
        sent.push(JSON.parse(JSON.stringify(params)));
        const i = n++;
        const s = script[Math.min(i, script.length - 1)];
        let onText: ((d: string) => void) | null = null;
        return {
          on(_e: "text", l: (d: string) => void) {
            onText = l;
            return this;
          },
          finalMessage: () =>
            new Promise<Anthropic.Message>((resolve, reject) => {
              if (opts.hangOn === i) {
                // Never finishes on its own: only an abort ends it.
                options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
                s.text?.forEach((d) => onText?.(d));
                return;
              }
              s.text?.forEach((d) => onText?.(d));
              resolve(message(s, i));
            }),
        };
      },
    },
  };
  return { client, sent };
}

function engineWith(
  client: StreamingClient,
  execute = vi.fn<ToolExecutor>(async () => ({ ok: true })),
  maxRoundTrips?: number
) {
  const engine = new ReceptionistEngine({
    client,
    model: "test-model",
    system: [{ type: "text", text: "sys" }],
    tools: [],
    execute,
    maxRoundTrips,
  });
  return { engine, execute };
}

/** The history the API will be sent next: every tool call answered, roles valid. */
function expectValidHistory(messages: Anthropic.MessageParam[]) {
  expect(messages[0]?.role).toBe("user");
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const ids = m.content.filter((b) => b.type === "tool_use").map((b) => (b as Anthropic.ToolUseBlock).id);
    if (!ids.length) continue;
    const next = messages[i + 1];
    expect(next?.role).toBe("user");
    const answered = (next!.content as Anthropic.ToolResultBlockParam[]).map((b) => b.tool_use_id);
    expect(answered).toEqual(ids);
  }
}

// --- The loop -----------------------------------------------------------------

describe("ReceptionistEngine", () => {
  it("streams a plain reply and records the exchange", async () => {
    const { client, sent } = fakeClient([{ text: ["Of course", ", what day?"] }]);
    const { engine } = engineWith(client);
    const deltas: string[] = [];
    const turn = await engine.respond("Can I book a cut?", { onText: (d) => deltas.push(d) });

    expect(deltas).toEqual(["Of course", ", what day?"]);
    expect(turn.text).toBe("Of course, what day?");
    expect(turn.stopReason).toBe("end_turn");
    expect(sent[0].model).toBe("test-model");
    expect(engine.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(turn.usage.cacheRead).toBe(7);
  });

  it("runs a tool, hands back the result and carries on talking", async () => {
    const { client, sent } = fakeClient([
      { text: ["Let me check."], tools: [{ name: "check_availability", input: { service: "cut", date: "Thursday" } }] },
      { text: ["Thursday at ten is free."] },
    ]);
    const execute = vi.fn<ToolExecutor>(async () => ({ options: ["10:00"] }));
    const { engine } = engineWith(client, execute);
    const events: string[] = [];
    const turn = await engine.respond("Thursday for a cut?", {
      onToolStart: (n) => events.push(`start:${n}`),
      onToolResult: (n, _r, err) => events.push(`done:${n}:${err}`),
    });

    expect(execute).toHaveBeenCalledWith("check_availability", { service: "cut", date: "Thursday" });
    expect(events).toEqual(["start:check_availability", "done:check_availability:false"]);
    // The words either side of the tool call are separate sentences.
    expect(turn.text).toBe("Let me check. Thursday at ten is free.");
    expect(turn.tools).toHaveLength(1);

    // The second request carried the tool result, as JSON, against its call.
    const second = sent[1].messages;
    const last = second[second.length - 1];
    expect(last.role).toBe("user");
    const block = (last.content as Anthropic.ToolResultBlockParam[])[0];
    expect(block.tool_use_id).toBe("tu_0_0");
    expect(JSON.parse(block.content as string)).toEqual({ options: ["10:00"] });

    expectValidHistory(engine.messages);
    expect(engine.messages).toHaveLength(4);
  });

  it("answers every tool call in one message, including one that failed", async () => {
    const { client, sent } = fakeClient([
      { tools: [{ name: "a", input: {} }, { name: "b", input: {} }] },
      { text: ["Done."] },
    ]);
    const execute = vi.fn<ToolExecutor>(async (name) => {
      if (name === "b") throw new Error("database down");
      return { ok: true };
    });
    const { engine } = engineWith(client, execute);
    const turn = await engine.respond("hi");

    const results = sent[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["tu_0_0", "tu_0_1"]);
    expect(results[1].is_error).toBe(true);
    expect(turn.tools[1].isError).toBe(true);
    expectValidHistory(engine.messages);
  });

  it("never runs a tool from a refused or truncated reply", async () => {
    for (const stop of ["refusal", "max_tokens"] as const) {
      const { client } = fakeClient([{ tools: [{ name: "book_appointment", input: { time: "10" } }], stop }]);
      const { engine, execute } = engineWith(client);
      const turn = await engine.respond("book it");
      expect(execute).not.toHaveBeenCalled();
      expect(turn.text).toBe(FALLBACK_REPLY);
      expectValidHistory(engine.messages);
      expect(engine.messages.at(-1)!.role).toBe("assistant");
    }
  });

  it("stops a runaway tool loop and says so", async () => {
    const { client } = fakeClient([{ tools: [{ name: "check_availability", input: {} }] }]);
    const { engine, execute } = engineWith(client, undefined, 3);
    const turn = await engine.respond("anything free?");
    expect(execute).toHaveBeenCalledTimes(3);
    expect(turn.stopReason).toBe("round_trip_limit");
    expect(turn.text).toBe(FALLBACK_REPLY);
    expectValidHistory(engine.messages);
    expect(engine.messages.at(-1)!.role).toBe("assistant");
  });

  it("keeps a booking made before the caller interrupted", async () => {
    const { client, sent } = fakeClient(
      [
        { tools: [{ name: "book_appointment", input: { time: "10:00" } }] },
        { text: ["You're booked in for"] },
        { text: ["No problem."] },
      ],
      { hangOn: 1 }
    );
    const { engine, execute } = engineWith(client);
    const ctrl = new AbortController();
    const turn = engine.respond("ten please", { onText: () => ctrl.abort() }, ctrl.signal);
    const result = await turn;

    expect(result.stopReason).toBe("aborted");
    expect(execute).toHaveBeenCalledTimes(1);
    // The booking exchange is in the history; the half-spoken reply is not.
    expectValidHistory(engine.messages);
    expect(engine.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);

    // The next turn follows on validly and the model can see the booking.
    await engine.respond("actually, is it with Jo?");
    const nextSent = sent[2].messages;
    expect(JSON.stringify(nextSent)).toContain("book_appointment");
    expect(nextSent.at(-1)).toEqual({ role: "user", content: "actually, is it with Jo?" });
  });
});

// --- Tools and caller ID ----------------------------------------------------

describe("receptionist tools", () => {
  it("hides the caller number from the model; the line fills it in", () => {
    const [tool] = toClaudeTools([
      {
        type: "function",
        function: {
          name: "save_customer_details",
          description: "d",
          parameters: {
            type: "object",
            properties: { name: { type: "string" }, callerNumber: { type: "string" } },
            required: ["name", "callerNumber"],
          },
        },
      },
    ]);
    expect(Object.keys((tool.input_schema as { properties: object }).properties)).toEqual(["name"]);
    expect(tool.input_schema.required).toEqual(["name"]);
  });

  it("always sets callerNumber from caller ID", () => {
    expect(
      withCallerContext("save_customer_details", { name: "Jo", callerNumber: "+440000" }, "+447700900123")
    ).toEqual({ name: "Jo", callerNumber: "+447700900123" });
  });

  it("leaves a blank phone for the booking code, so it can say it used caller ID", () => {
    expect(withCallerContext("book_appointment", { customerPhone: "" }, "+447700900123").customerPhone).toBe("");
  });

  it("looks a booking up by the caller's number when none was given", () => {
    expect(withCallerContext("find_appointment", {}, "+447700900123").customerPhone).toBe("+447700900123");
    expect(withCallerContext("cancel_appointment", { customerPhone: " " }, "+447700900123").customerPhone).toBe(
      "+447700900123"
    );
    expect(
      withCallerContext("find_appointment", { customerPhone: "07700 900999" }, "+447700900123").customerPhone
    ).toBe("07700 900999");
    // Withheld: nothing is invented.
    expect(withCallerContext("find_appointment", {}, null)).toEqual({});
  });
});

// --- Prompt -------------------------------------------------------------------

describe("receptionist prompt", () => {
  const cfg = {
    diary: "native",
    timeZone: "Europe/London",
    hours: [],
    services: [],
    stylists: [],
    calComApiKey: null,
    calComEventTypeId: null,
  } as unknown as SalonConfig;

  it("caches the instructions and keeps the clock out of the cached part", () => {
    const now = new Date("2026-09-25T17:05:00Z");
    const [stable, context] = buildSystem(cfg, "Shogo", null, now, "+447700900123");
    expect(stable.cache_control).toEqual({ type: "ephemeral" });
    expect(stable.text).toContain("answering the phone for Shogo");
    expect(stable.text).not.toContain("18:05");
    expect(context.cache_control).toBeUndefined();
    expect(context.text).toContain("Friday, 25 September 2026 at 18:05");
    expect(context.text).toContain("18:05");

    // A different minute leaves the cached block byte-identical.
    const later = buildSystem(cfg, "Shogo", null, new Date("2026-09-25T17:09:00Z"), null);
    expect(later[0].text).toBe(stable.text);
    expect(later[1].text).toContain("withheld");
  });

  it("says the call is recorded in the greeting", () => {
    expect(greetingFor("Shogo")).toMatch(/Shogo.*calls are recorded/);
  });
});
