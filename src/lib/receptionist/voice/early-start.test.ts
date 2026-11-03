import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ReceptionistEngine, type StreamingClient, type ToolExecutor } from "../engine";
import { soundsUnfinished, VoiceCall, type VoiceEvent } from "./call";
import type { SttHandlers, TextToSpeech } from "./providers";

/**
 * Starting the reply early: on the caller's words once they stand still,
 * before the recogniser says the turn is over. The real engine, with a
 * stand-in model that answers each request with the next scripted reply.
 */

type Reply = { text?: string; tool?: { name: string; input: Record<string, unknown> } };

function model(script: Reply[]) {
  const requests: Array<{ messages: Anthropic.MessageParam[]; signal?: AbortSignal }> = [];
  const client: StreamingClient = {
    messages: {
      stream(params, options) {
        requests.push({ messages: JSON.parse(JSON.stringify(params.messages)), signal: options?.signal });
        const r = script[Math.min(requests.length - 1, script.length - 1)];
        let onText: ((d: string) => void) | null = null;
        return {
          on(_e: "text", l: (d: string) => void) {
            onText = l;
            return this;
          },
          finalMessage: () =>
            new Promise<Anthropic.Message>((resolve, reject) => {
              if (options?.signal?.aborted) return reject(new Error("aborted"));
              if (r.text) onText?.(r.text);
              resolve({
                id: `m${requests.length}`,
                type: "message",
                role: "assistant",
                model: "test",
                content: [
                  ...(r.text ? [{ type: "text" as const, text: r.text, citations: null }] : []),
                  ...(r.tool ? [{ type: "tool_use" as const, id: `t${requests.length}`, name: r.tool.name, input: r.tool.input }] : []),
                ],
                stop_reason: r.tool ? "tool_use" : "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              } as unknown as Anthropic.Message);
            }),
        };
      },
    },
  };
  return { client, requests };
}

const tick = (n = 5) => new Promise<void>((r) => (n <= 0 ? r() : setTimeout(() => tick(n - 1).then(r), 0)));

function setUp(script: Reply[]) {
  const { client, requests } = model(script);
  const execute = vi.fn<ToolExecutor>(async () => ({ ok: true }));
  const engine = new ReceptionistEngine({
    client,
    model: "test",
    system: [{ type: "text", text: "sys" }],
    tools: [],
    execute,
  });
  engine.messages.push({ role: "user", content: "[The call has connected.]" }, { role: "assistant", content: "Hi." });
  let stt: SttHandlers | null = null;
  // Early starts wait for the test to say the words have stood still.
  const pending: Array<() => void> = [];
  let clock = 10_000;
  const events: VoiceEvent[] = [];
  const tts: TextToSpeech = {
    bytesPerSecond: 100,
    async *synth() {
      yield Buffer.alloc(100); // a second of audio
    },
  };
  const call = new VoiceCall({
    engine,
    stt: {
      async open(h) {
        stt = h;
        return { send: vi.fn(), close: vi.fn() };
      },
    },
    tts,
    out: { audio: vi.fn(), clear: vi.fn(), event: (e) => events.push(e) },
    greeting: "Hi.",
    now: () => clock,
    silence: null,
    schedule: (fn) => {
      pending.push(fn);
      return () => pending.splice(pending.indexOf(fn), 1);
    },
  });
  return {
    call,
    engine,
    execute,
    requests,
    events,
    stt: () => stt!,
    /** The caller's words have stood still long enough. */
    still: () => pending.splice(0).forEach((f) => f()),
    /** Past the greeting's playback, so the receptionist is quiet. */
    quiet: () => (clock += 60_000),
  };
}

describe("starting the reply early", () => {
  it("starts on the caller's words once they stand still, and the turn carries on from it", async () => {
    const t = setUp([{ text: "Yes, Thursday at three is free." }]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onInterim("Thursday at 3");
    t.still();
    expect(t.requests).toHaveLength(1); // started before the turn ended
    t.stt().onFinal("Thursday at 3?");
    t.stt().onEndOfTurn();
    await tick();

    expect(t.requests).toHaveLength(1); // and used: no second request
    expect(t.engine.messages.at(-2)).toEqual({ role: "user", content: "Thursday at 3" });
    expect(JSON.stringify(t.engine.messages.at(-1))).toContain("Yes, Thursday at three is free.");
    const m = t.events.find((e) => e.type === "metrics");
    expect(m?.type === "metrics" && m.startedEarly).toBe(true);
  });

  it("is cancelled by more words, and the turn starts afresh on all of them", async () => {
    const t = setUp([{ text: "Sorry?" }, { text: "Yes, Thursday at three is free." }]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onInterim("Thursday");
    t.still();
    expect(t.requests).toHaveLength(1);
    t.stt().onInterim("Thursday at 3 please");
    expect(t.requests[0].signal?.aborted).toBe(true);
    t.stt().onFinal("Thursday at 3 please.");
    t.stt().onEndOfTurn();
    await tick();

    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].messages.at(-1)).toEqual({ role: "user", content: "Thursday at 3 please." });
    // The cancelled start left nothing in the conversation.
    expect(t.engine.messages.filter((m) => m.role === "user" && m.content === "Thursday")).toHaveLength(0);
  });

  it("never does what an early start asked for unless the turn takes it up", async () => {
    // Started on "Book it", which the model answers with a booking; the
    // caller goes on to say "Book it for Friday instead".
    const t = setUp([
      { tool: { name: "book_appointment", input: { bookingRef: "R1" } } },
      { text: "Friday then. What time?" },
    ]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onInterim("Book it");
    t.still();
    await tick();
    t.stt().onInterim("Book it for Friday instead");
    t.stt().onFinal("Book it for Friday instead.");
    t.stt().onEndOfTurn();
    await tick();

    expect(t.execute).not.toHaveBeenCalled();
    expect(t.requests).toHaveLength(2);
  });

  it("does not start early while the receptionist is still talking", async () => {
    const t = setUp([{ text: "Yes." }]);
    await t.call.start();
    await tick(); // the greeting has gone out and is still playing
    t.stt().onInterim("Hello");
    t.still();
    expect(t.requests).toHaveLength(0);
  });
});

describe("a caller who stops part-way through a sentence", () => {
  it("is given a moment to finish, and answered on the whole of it", async () => {
    const t = setUp([{ text: "Yes, half past four is free." }]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onFinal("Can I get half");
    t.stt().onEndOfTurn(); // the recogniser calls it over, mid-phrase
    await tick();
    expect(t.requests).toHaveLength(0);

    t.stt().onFinal("past four?");
    t.stt().onEndOfTurn();
    await tick();
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].messages.at(-1)).toEqual({ role: "user", content: "Can I get half past four?" });
  });

  it("is still waited for when the recogniser signals the end a second time", async () => {
    const t = setUp([{ text: "Thanks, Roy." }]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onFinal("My name is");
    t.stt().onEndOfTurn(); // after 0.4s of silence
    t.stt().onEndOfTurn(); // the backstop, about a second later
    await tick();
    expect(t.requests).toHaveLength(0);

    t.stt().onFinal("Roy.");
    t.stt().onEndOfTurn();
    await tick();
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].messages.at(-1)).toEqual({ role: "user", content: "My name is Roy." });
  });

  it("is answered on what they said when nothing more comes", async () => {
    const t = setUp([{ text: "What can I help you with?" }]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onFinal("I'm looking for");
    t.stt().onEndOfTurn();
    await tick();
    expect(t.requests).toHaveLength(0);
    t.still(); // the wait runs out
    await tick();
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].messages.at(-1)).toEqual({ role: "user", content: "I'm looking for" });
  });
});

describe("what counts as an unfinished sentence", () => {
  // As the recogniser gave them on real calls: whole sentences punctuated,
  // fragments bare.
  it.each([
    ["Can I get half", true],
    ["Hi. Hi. I'm looking for", true],
    ["I'm thinking", true],
    ["I was wondering", true],
    ["if we can", true],
    ["Yeah. Cash", true],
    ["I'm looking for.", true],
    ["Can I get half past four?", false],
    ["I'm looking for a ladies cut.", false],
    ["Roy.", false],
    ["Yes, please.", false],
    ["That's everything. Thank you.", false],
    ["I'm trying to pick a day?", false],
  ])("%s", (text, unfinished) => {
    expect(soundsUnfinished(text)).toBe(unfinished);
  });
});
