/**
 * Stress tests for a spoken call: the things real phone lines do that a tidy
 * conversation never does. Callers talk over the diary work, go quiet, sit on
 * speakerphone, and the providers drop out mid-call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnHooks, TurnResult } from "../engine";
import { VoiceCall, type VoiceEvent } from "./call";
import { ElevenLabsTts, type SttHandlers, type TextToSpeech } from "./providers";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

const done = (text: string, extra: Partial<TurnResult> = {}): TurnResult => ({
  text,
  tools: [],
  stopReason: "end_turn",
  endCall: false,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  ...extra,
});

type Respond = (text: string, hooks: TurnHooks, signal?: AbortSignal) => Promise<TurnResult>;

function harness(
  respond: Respond,
  opts: {
    playbackMs?: number;
    silence?: { promptMs: number; hangupMs: number } | null;
    openStt?: () => Promise<void>;
    tts?: TextToSpeech;
  } = {}
) {
  const handlers: SttHandlers[] = [];
  const spoken: string[] = [];
  const events: VoiceEvent[] = [];
  const hangup = vi.fn();
  const clear = vi.fn();
  const bytesPerSecond = 1000;
  const tts: TextToSpeech = opts.tts ?? {
    bytesPerSecond,
    async *synth(text) {
      spoken.push(text);
      yield Buffer.alloc(((opts.playbackMs ?? 1000) / 1000) * bytesPerSecond);
    },
  };
  const engine = { respond: vi.fn(respond) };
  const call = new VoiceCall({
    engine,
    stt: {
      async open(h) {
        await opts.openStt?.();
        handlers.push(h);
        return { send: vi.fn(), close: vi.fn() };
      },
    },
    tts,
    out: { audio: () => {}, clear, event: (e) => events.push(e), hangup },
    greeting: "Thank you for calling Shogo.",
    silence: opts.silence === undefined ? null : opts.silence,
    hangupGraceMs: 0,
  });
  const stt = () => handlers[handlers.length - 1];
  /** The caller says something and pauses. */
  const says = async (text: string) => {
    stt().onFinal(text);
    stt().onEndOfTurn();
    await flush();
  };
  return { call, engine, spoken, events, hangup, clear, handlers, stt, says };
}

/** A promise the test resolves when it chooses. */
function gate<T = void>() {
  let open!: (v: T) => void;
  const p = new Promise<T>((r) => (open = r));
  return { p, open };
}

describe("talking over the diary work", () => {
  it("does not start the next reply until a booking already under way has finished", async () => {
    const booking = gate();
    let bookings = 0;
    const seenBy: string[] = [];
    const h = harness(async (text, hooks, signal) => {
      seenBy.push(text);
      if (text.includes("two")) {
        hooks.onText?.("Let me book that. ");
        hooks.onToolStart?.("book_appointment", {});
        await booking.p; // the diary write is in flight
        bookings++;
        if (signal?.aborted) return done("", { stopReason: "aborted" });
      }
      return done("Okay.");
    });
    await h.call.start();
    await vi.advanceTimersByTimeAsync(2000);

    await h.says("book me in Tuesday at two please");
    // The caller changes their mind while the booking is being written.
    await h.says("actually make it three instead");
    await flush();
    // The second reply must wait: the model has not yet seen that the first
    // booking went through, and would book again.
    expect(seenBy).toEqual(["book me in Tuesday at two please"]);

    booking.open();
    await vi.advanceTimersByTimeAsync(10);
    expect(bookings).toBe(1);
    expect(seenBy).toEqual(["book me in Tuesday at two please", "actually make it three instead"]);
  });

  it("keeps words from a turn that was overtaken before the model saw them", async () => {
    const slow = gate();
    const seen: string[] = [];
    const h = harness(async (text) => {
      seen.push(text);
      if (seen.length === 1) await slow.p;
      return done("Okay.");
    });
    await h.call.start();
    await vi.advanceTimersByTimeAsync(2000);

    await h.says("I'd like a cut");
    await h.says("with Jo");
    await h.says("on Friday");
    slow.open();
    await vi.advanceTimersByTimeAsync(10);
    // "with Jo" never reached the model on its own; it must not be lost.
    expect(seen[1]).toBe("with Jo on Friday");
  });
});

describe("a caller who goes quiet", () => {
  it("checks they are still there, then says goodbye and hangs up", async () => {
    const h = harness(async () => done("Okay."), { silence: { promptMs: 8000, hangupMs: 8000 } });
    await h.call.start();
    await vi.advanceTimersByTimeAsync(1000); // greeting plays
    await vi.advanceTimersByTimeAsync(8500);
    expect(h.spoken).toContain("Are you still there?");
    expect(h.hangup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.spoken.at(-1)).toMatch(/goodbye/i);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.hangup).toHaveBeenCalledTimes(1);
  });

  it("carries on as normal if they answer the check", async () => {
    const h = harness(async () => done("Lovely, how can I help?"), { silence: { promptMs: 8000, hangupMs: 8000 } });
    await h.call.start();
    await vi.advanceTimersByTimeAsync(9500);
    expect(h.spoken).toContain("Are you still there?");
    await vi.advanceTimersByTimeAsync(1500);
    await h.says("yes sorry I'm here");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(h.hangup).not.toHaveBeenCalled();
  });

  it("does not count the receptionist's own thinking and talking as silence", async () => {
    const h = harness(
      async () => {
        await new Promise((r) => setTimeout(r, 12_000)); // a very slow diary
        return done("Tuesday is free.");
      },
      { silence: { promptMs: 8000, hangupMs: 8000 } }
    );
    await h.call.start();
    await vi.advanceTimersByTimeAsync(1500);
    await h.says("anything on Tuesday");
    await vi.advanceTimersByTimeAsync(12_500);
    expect(h.spoken).not.toContain("Are you still there?");
  });
});

describe("providers dropping out mid-call", () => {
  it("reconnects the recogniser if its connection drops", async () => {
    const h = harness(async () => done("Okay."));
    await h.call.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.handlers).toHaveLength(1);

    h.stt().onClose?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.handlers).toHaveLength(2);
    await h.says("can I book a cut");
    expect(h.engine.respond).toHaveBeenCalledWith("can I book a cut", expect.anything(), expect.anything());
  });

  it("apologises and hangs up if the recogniser cannot be got back", async () => {
    let opens = 0;
    const h = harness(async () => done("Okay."), {
      openStt: async () => {
        if (++opens > 1) throw new Error("Deepgram 503");
      },
    });
    await h.call.start();
    await vi.advanceTimersByTimeAsync(1500);
    h.stt().onClose?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.spoken.at(-1)).toMatch(/trouble hearing/i);
    expect(h.hangup).toHaveBeenCalledTimes(1);
  });
});

describe("speakerphone echo", () => {
  it("does not interrupt itself when it hears its own voice back", async () => {
    const h = harness(
      async (_t, hooks) => {
        hooks.onText?.("We have nine o'clock or quarter past one on Tuesday. ");
        return done("We have nine o'clock or quarter past one on Tuesday.");
      },
      { playbackMs: 5000 }
    );
    await h.call.start();
    await vi.advanceTimersByTimeAsync(6000);
    await h.says("anything Tuesday");
    await vi.advanceTimersByTimeAsync(500);

    h.stt().onInterim("quarter past one on");
    h.stt().onFinal("quarter past one on Tuesday");
    expect(h.clear).not.toHaveBeenCalled();

    // A real interruption still works.
    h.stt().onInterim("no Wednesday please");
    expect(h.clear).toHaveBeenCalledTimes(1);
  });
});

describe("the voice service refusing a request", () => {
  it("retries when ElevenLabs is busy, rather than dropping the sentence", async () => {
    vi.useRealTimers();
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("too_many_concurrent_requests", { status: 429 });
      return new Response(new Uint8Array([1, 0, 2, 0]), { status: 200 });
    }) as typeof fetch;
    try {
      const tts = new ElevenLabsTts("key", { kind: "pcm16", sampleRate: 16000 });
      const chunks: Buffer[] = [];
      for await (const c of tts.synth("Hello.", new AbortController().signal)) chunks.push(c);
      expect(calls).toBe(2);
      expect(Buffer.concat(chunks).length).toBe(4);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("does not retry a refusal that will not change, like a used-up plan", async () => {
    vi.useRealTimers();
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("quota_exceeded", { status: 401 });
    }) as typeof fetch;
    try {
      const tts = new ElevenLabsTts("key", { kind: "pcm16", sampleRate: 16000 });
      await expect(async () => {
        for await (const _ of tts.synth("Hello.", new AbortController().signal)) void _;
      }).rejects.toThrow(/401/);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("hanging up mid-turn", () => {
  it("still has the interrupted turn's tokens once the call has settled", async () => {
    const slow = gate();
    const h = harness(async (_t, _hooks, signal) => {
      await slow.p;
      return done("", { stopReason: signal?.aborted ? "aborted" : "end_turn", usage: { input: 500, output: 20, cacheRead: 0, cacheWrite: 0 } });
    });
    await h.call.start();
    await vi.advanceTimersByTimeAsync(1500);
    await h.says("hello");
    h.call.close();
    slow.open();
    await h.call.settled();
    expect(h.call.tokenUsage().inputTokens).toBe(500);
  });
});
