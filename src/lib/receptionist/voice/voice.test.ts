import { describe, expect, it, vi } from "vitest";
import type { TurnHooks, TurnResult } from "../engine";
import { VoiceCall, type VoiceEvent } from "./call";
import { SentenceChunker } from "./sentences";
import { signVoicePass, verifyVoicePass } from "./token";
import { ElevenLabsTts, evenChunks, speakingSpeed, type SttHandlers, type TextToSpeech } from "./providers";

const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

// --- Sentence chunking ------------------------------------------------------

describe("SentenceChunker", () => {
  it("releases each sentence as soon as it is complete", () => {
    const c = new SentenceChunker();
    expect(c.push("Let me just check that")).toEqual([]);
    expect(c.push(" for you. I've got nine")).toEqual(["Let me just check that for you."]);
    expect(c.push(" o'clock free. Would")).toEqual(["I've got nine o'clock free."]);
    expect(c.flush()).toEqual(["Would"]);
  });

  it("does not cut inside a time or a price", () => {
    const c = new SentenceChunker();
    expect(c.push("It's at 9.30 and costs £45.00 in total. ")).toEqual(["It's at 9.30 and costs £45.00 in total."]);
  });

  it("holds back a very short sentence to join the next", () => {
    const c = new SentenceChunker();
    expect(c.push("Right. ")).toEqual([]);
    expect(c.push("That's booked for you. ")).toEqual(["Right. That's booked for you."]);
  });

  it("cuts a run-on reply at a comma rather than waiting", () => {
    const c = new SentenceChunker();
    const long = "We have a lot of availability that week, " + "especially in the mornings, ".repeat(6);
    const out = c.push(long);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].endsWith(",")).toBe(true);
  });
});

// --- Passes -------------------------------------------------------------------

describe("voice passes", () => {
  const pass = { organizationId: "org1", userId: "u1", callerNumber: null, exp: 2_000 };

  it("round-trips a valid pass", () => {
    expect(verifyVoicePass(signVoicePass(pass, "s"), "s", 1_000)).toEqual(pass);
  });

  it("refuses an expired, tampered or wrongly signed pass", () => {
    const t = signVoicePass(pass, "s");
    expect(verifyVoicePass(t, "s", 3_000)).toBeNull();
    expect(verifyVoicePass(t, "other", 1_000)).toBeNull();
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...pass, organizationId: "org2" })).toString("base64url");
    expect(verifyVoicePass(`${forged}.${sig}`, "s", 1_000)).toBeNull();
    expect(verifyVoicePass("nonsense", "s", 1_000)).toBeNull();
  });
});

// --- Audio framing -----------------------------------------------------------

describe("evenChunks", () => {
  it("never splits a 16-bit sample across chunks", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.enqueue(new Uint8Array([4, 5]));
        c.enqueue(new Uint8Array([6]));
        c.close();
      },
    });
    const out: number[][] = [];
    for await (const b of evenChunks(body, 2)) out.push([...b]);
    expect(out).toEqual([[1, 2], [3, 4], [5, 6]]);
  });
});

// --- Speaking speed -----------------------------------------------------------

describe("speaking speed", () => {
  it("defaults to 0.9 and stays inside what ElevenLabs accepts", () => {
    expect(speakingSpeed(undefined)).toBe(0.9);
    expect(speakingSpeed(Number("not a number"))).toBe(0.9);
    expect(speakingSpeed(1)).toBe(1);
    expect(speakingSpeed(0.5)).toBe(0.7);
    expect(speakingSpeed(2)).toBe(1.2);
  });

  it("is sent with every sentence", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(new Uint8Array([0, 0, 1, 1]), { status: 200 });
    }) as typeof fetch;
    try {
      const tts = new ElevenLabsTts("key", { kind: "pcm16", sampleRate: 16000 }, { voiceId: "v1" });
      for await (const chunk of tts.synth("Hello there.", new AbortController().signal)) expect(chunk.length).toBe(4);
      expect(calls[0].url).toContain("/v1/text-to-speech/v1/stream?output_format=pcm_16000");
      expect(calls[0].body).toEqual({
        text: "Hello there.",
        model_id: "eleven_flash_v2_5",
        voice_settings: { speed: 0.9 },
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// --- The call ------------------------------------------------------------------

function harness(
  respond: (text: string, hooks: TurnHooks, signal?: AbortSignal) => Promise<TurnResult>,
  opts: { playbackSecondsPerPiece?: number } = {}
) {
  let clock = 0;
  let stt: SttHandlers | null = null;
  const spoken: string[] = [];
  const events: VoiceEvent[] = [];
  const audio: Buffer[] = [];
  const clear = vi.fn();
  const bytesPerSecond = 100;
  const tts: TextToSpeech = {
    bytesPerSecond,
    async *synth(text, signal) {
      spoken.push(text);
      if (signal.aborted) return;
      yield Buffer.alloc(bytesPerSecond * (opts.playbackSecondsPerPiece ?? 1));
    },
  };
  const engine = { respond: vi.fn(respond) };
  const call = new VoiceCall({
    engine,
    stt: {
      async open(h) {
        stt = h;
        return { send: vi.fn(), close: vi.fn() };
      },
    },
    tts,
    out: { audio: (b) => audio.push(b), clear, event: (e) => events.push(e) },
    greeting: "Thank you for calling Shogo.",
    now: () => clock,
  });
  return {
    call,
    engine,
    spoken,
    events,
    audio,
    clear,
    stt: () => stt!,
    advance: (ms: number) => (clock += ms),
  };
}

const done = (text: string): TurnResult => ({
  text,
  tools: [],
  stopReason: "end_turn",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

describe("VoiceCall", () => {
  it("greets, then answers the caller once they pause", async () => {
    const h = harness(async (text, hooks) => {
      hooks.onText?.("Of course, what day ");
      hooks.onText?.("works for you? ");
      return done("Of course, what day works for you?");
    });
    await h.call.start();
    await tick();
    expect(h.spoken).toEqual(["Thank you for calling Shogo."]);

    h.advance(5_000); // greeting has finished playing
    h.stt().onFinal("Can I book");
    h.stt().onFinal("a cut please");
    h.stt().onEndOfTurn();
    await tick(10);

    expect(h.engine.respond).toHaveBeenCalledWith("Can I book a cut please", expect.anything(), expect.anything());
    expect(h.spoken).toEqual(["Thank you for calling Shogo.", "Of course, what day works for you?"]);
    expect(h.events).toContainEqual({ type: "caller", text: "Can I book a cut please", final: true });
    expect(h.events.some((e) => e.type === "metrics" && e.firstAudioMs !== null)).toBe(true);
    expect(h.call.log.map((l) => l.who)).toEqual(["assistant", "caller", "assistant"]);
  });

  it("stops talking when the caller talks over it", async () => {
    let seenSignal: AbortSignal | undefined;
    const h = harness(
      async (_t, hooks, signal) => {
        seenSignal = signal;
        hooks.onText?.("We have nine o'clock or quarter past one on Tuesday. ");
        return done("…");
      },
      { playbackSecondsPerPiece: 10 }
    );
    await h.call.start();
    await tick();
    h.advance(20_000);
    h.stt().onFinal("Tuesday please");
    h.stt().onEndOfTurn();
    await tick(10);
    expect(h.clear).not.toHaveBeenCalled();

    // Mid-reply (ten seconds of audio queued), the caller cuts in.
    h.advance(1_000);
    h.stt().onInterim("actually Wednesday");
    expect(h.clear).toHaveBeenCalledTimes(1);
    expect(seenSignal?.aborted).toBe(true);
    expect(h.events).toContainEqual({ type: "interrupted" });
  });

  it("does not treat a single word as an interruption", async () => {
    const h = harness(async () => done(""), { playbackSecondsPerPiece: 10 });
    await h.call.start();
    await tick();
    h.stt().onInterim("mm");
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("fills the silence while the diary is checked, unless it already spoke", async () => {
    const h = harness(async (_t, hooks) => {
      hooks.onToolStart?.("check_availability", {});
      hooks.onText?.("Tuesday at ten is free. ");
      return done("Tuesday at ten is free.");
    });
    await h.call.start();
    await tick();
    h.advance(5_000);
    h.stt().onFinal("anything Tuesday");
    h.stt().onEndOfTurn();
    await tick(10);
    expect(h.spoken.slice(1)).toEqual(["One moment.", "Tuesday at ten is free."]);

    const h2 = harness(async (_t, hooks) => {
      hooks.onText?.("Let me just check that for you.");
      hooks.onToolStart?.("check_availability", {});
      hooks.onText?.(" Tuesday at ten is free. ");
      return done("");
    });
    await h2.call.start();
    await tick();
    h2.advance(5_000);
    h2.stt().onFinal("anything Tuesday");
    h2.stt().onEndOfTurn();
    await tick(10);
    expect(h2.spoken.slice(1)).toEqual(["Let me just check that for you.", "Tuesday at ten is free."]);
  });

  it("ignores a pause with nothing said", async () => {
    const h = harness(async () => done("x"));
    await h.call.start();
    h.stt().onEndOfTurn();
    await tick();
    expect(h.engine.respond).not.toHaveBeenCalled();
  });
});
