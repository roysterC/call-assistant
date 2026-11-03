import { describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import type Anthropic from "@anthropic-ai/sdk";
import { ReceptionistEngine, type StreamingClient, type ToolExecutor } from "../engine";
import { listeningFor, VoiceCall } from "./call";
import {
  FluxStt,
  DeepgramStt,
  fluxConfigureMessage,
  fluxListenUrl,
  handleFluxMessage,
  speechToText,
  type SpeechToText,
  type SttHandlers,
  type TextToSpeech,
} from "./providers";

/** Deepgram's Flux: turns ended by what was said, and early starts it calls. */

describe("the Flux stream address", () => {
  it("asks for Flux on 8kHz phone audio, with the turn settings and the salon's words", () => {
    const url = new URL(fluxListenUrl({ kind: "mulaw8k" }, { keyterms: ["Chloe", "balayage"] }));
    // Deepgram's EU region: the voice server is in Germany.
    expect(url.origin + url.pathname).toBe("wss://api.eu.deepgram.com/v2/listen");
    const p = url.searchParams;
    expect(p.get("model")).toBe("flux-general-en");
    expect(p.get("encoding")).toBe("mulaw");
    expect(p.get("sample_rate")).toBe("8000");
    expect(p.get("eot_threshold")).toBe("0.8");
    expect(p.get("eager_eot_threshold")).toBe("0.5");
    expect(p.get("eot_timeout_ms")).toBe("6000");
    expect(p.has("numerals")).toBe(false); // "quarter to 12" came out as "0.25 to 12"
    expect(p.getAll("keyterm")).toEqual(["Chloe", "balayage"]);
  });

  it("never asks for an early start surer than the end itself, which Deepgram refuses, and can leave it out", () => {
    expect(new URL(fluxListenUrl({ kind: "mulaw8k" }, { eotThreshold: 0.6, eagerEotThreshold: 0.9 })).searchParams.get("eager_eot_threshold")).toBe("0.6");
    expect(new URL(fluxListenUrl({ kind: "mulaw8k" }, { eagerEotThreshold: null })).searchParams.has("eager_eot_threshold")).toBe(false);
  });

  it("can be pointed back at Deepgram's US region", () => {
    expect(fluxListenUrl({ kind: "mulaw8k" }, { host: "wss://api.deepgram.com" })).toMatch(/^wss:\/\/api\.deepgram\.com\/v2\/listen\?/);
  });

  it("takes the lab's microphone audio as 16-bit PCM", () => {
    const p = new URL(fluxListenUrl({ kind: "pcm16", sampleRate: 16000 })).searchParams;
    expect(p.get("encoding")).toBe("linear16");
    expect(p.get("sample_rate")).toBe("16000");
  });

  it("is used unless a Nova model is named", () => {
    expect(speechToText("k", { kind: "mulaw8k" })).toBeInstanceOf(FluxStt);
    expect(speechToText("k", { kind: "mulaw8k" }, { model: "flux-general-en" })).toBeInstanceOf(FluxStt);
    expect(speechToText("k", { kind: "mulaw8k" }, { model: "nova-3" })).toBeInstanceOf(DeepgramStt);
  });
});

describe("Flux's messages", () => {
  const handlers = () => ({
    onInterim: vi.fn(),
    onFinal: vi.fn(),
    onEndOfTurn: vi.fn(),
    onEagerEndOfTurn: vi.fn(),
    onTurnResumed: vi.fn(),
    onError: vi.fn(),
  });
  const turn = (event: string, transcript: string) =>
    JSON.stringify({ type: "TurnInfo", event, transcript, turn_index: 0, words: [], end_of_turn_confidence: 0.5 });

  it("pass on the turn so far, an early end, a resumed turn, and the end", () => {
    const h = handlers();
    handleFluxMessage(turn("StartOfTurn", "I was"), h);
    handleFluxMessage(turn("Update", "I was wondering"), h);
    handleFluxMessage(turn("EagerEndOfTurn", "I was wondering"), h);
    handleFluxMessage(turn("TurnResumed", "I was wondering if"), h);
    handleFluxMessage(turn("EndOfTurn", "I was wondering if you're free tomorrow"), h);
    expect(h.onInterim.mock.calls.map((c) => c[0])).toEqual(["I was", "I was wondering", "I was wondering if"]);
    expect(h.onEagerEndOfTurn).toHaveBeenCalledWith("I was wondering");
    expect(h.onTurnResumed).toHaveBeenCalledTimes(1);
    expect(h.onFinal).toHaveBeenCalledWith("I was wondering if you're free tomorrow");
    expect(h.onEndOfTurn).toHaveBeenCalledTimes(1);
  });

  it("report an error, and ignore what they cannot read", () => {
    const h = handlers();
    handleFluxMessage(JSON.stringify({ type: "Error", code: "X", description: "bad audio" }), h);
    handleFluxMessage("not json", h);
    handleFluxMessage(JSON.stringify({ type: "Connected" }), h);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError.mock.calls[0][0].message).toBe("bad audio");
    expect(h.onInterim).not.toHaveBeenCalled();
  });
});

// --- A call on Flux --------------------------------------------------------------

function model(replies: string[]) {
  const requests: Array<{ messages: Anthropic.MessageParam[]; signal?: AbortSignal }> = [];
  const client: StreamingClient = {
    messages: {
      stream(params, options) {
        requests.push({ messages: JSON.parse(JSON.stringify(params.messages)), signal: options?.signal });
        const text = replies[Math.min(requests.length - 1, replies.length - 1)];
        let onText: ((d: string) => void) | null = null;
        return {
          on(_e: "text", l: (d: string) => void) {
            onText = l;
            return this;
          },
          finalMessage: () =>
            new Promise<Anthropic.Message>((resolve, reject) => {
              if (options?.signal?.aborted) return reject(new Error("aborted"));
              onText?.(text);
              resolve({
                id: "m",
                type: "message",
                role: "assistant",
                model: "test",
                content: [{ type: "text", text, citations: null }],
                stop_reason: "end_turn",
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

function onFlux(replies: string[]) {
  const { client, requests } = model(replies);
  const engine = new ReceptionistEngine({
    client,
    model: "test",
    system: [{ type: "text", text: "sys" }],
    tools: [],
    execute: vi.fn<ToolExecutor>(async () => ({ ok: true })),
  });
  engine.messages.push({ role: "user", content: "[The call has connected.]" }, { role: "assistant", content: "Hi." });
  let h: SttHandlers | null = null;
  const stt: SpeechToText = {
    detectsTurns: true,
    async open(handlers) {
      h = handlers;
      return { send: vi.fn(), close: vi.fn() };
    },
  };
  const scheduled = vi.fn(() => () => {});
  let clock = 10_000;
  const tts: TextToSpeech = {
    bytesPerSecond: 100,
    async *synth() {
      yield Buffer.alloc(100);
    },
  };
  const call = new VoiceCall({
    engine,
    stt,
    tts,
    out: { audio: vi.fn(), clear: vi.fn(), event: vi.fn() },
    greeting: "Hi.",
    now: () => clock,
    silence: null,
    schedule: scheduled,
  });
  return { call, engine, requests, scheduled, stt: () => h!, quiet: () => (clock += 60_000) };
}

describe("a call on Flux", () => {
  it("starts the reply on Flux's early end, and the turn's end carries on from it", async () => {
    const t = onFlux(["Yes, we have tomorrow at ten."]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onInterim("Do you have anything tomorrow");
    expect(t.requests).toHaveLength(0); // no timer of our own
    t.stt().onEagerEndOfTurn!("Do you have anything tomorrow");
    expect(t.requests).toHaveLength(1);
    t.stt().onFinal("Do you have anything tomorrow");
    t.stt().onEndOfTurn();
    await tick();
    expect(t.requests).toHaveLength(1); // the early start was used
    expect(t.scheduled).not.toHaveBeenCalled();
  });

  it("drops the early start when Flux says they carried on", async () => {
    const t = onFlux(["Sorry?", "Yes, tomorrow at ten is free."]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onEagerEndOfTurn!("I was wondering");
    expect(t.requests).toHaveLength(1);
    t.stt().onTurnResumed!();
    expect(t.requests[0].signal?.aborted).toBe(true);
    t.stt().onFinal("I was wondering if you have tomorrow at ten");
    t.stt().onEndOfTurn();
    await tick();
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].messages.at(-1)).toEqual({ role: "user", content: "I was wondering if you have tomorrow at ten" });
  });

  it("answers an unpunctuated turn at once: Flux has already waited for the rest", async () => {
    const t = onFlux(["Thanks, Roy."]);
    await t.call.start();
    await tick(); // the greeting has gone out
    t.quiet();
    t.stt().onFinal("my name is Roy");
    t.stt().onEndOfTurn();
    await tick();
    expect(t.requests).toHaveLength(1);
    expect(t.scheduled).not.toHaveBeenCalled();
  });
});

describe("the Flux connection", () => {
  it("sends the phone's 20ms frames in 80ms chunks, passes Flux's messages on, and closes cleanly", async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = (server.address() as { port: number }).port;
    const got: Buffer[] = [];
    const texts: string[] = [];
    let auth = "";
    let path = "";
    server.on("connection", (sock, req) => {
      auth = String(req.headers.authorization);
      path = req.url ?? "";
      sock.on("message", (m, binary) => (binary ? got.push(m as Buffer) : texts.push(m.toString())));
      sock.send(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", transcript: "Thursday at three" }));
    });
    try {
      const h = { onInterim: vi.fn(), onFinal: vi.fn(), onEndOfTurn: vi.fn(), onError: vi.fn() };
      const stream = await new FluxStt("key", { kind: "mulaw8k" }, { host: `ws://127.0.0.1:${port}` }).open(h);
      for (let i = 0; i < 9; i++) stream.send(Buffer.alloc(160, i)); // nine 20ms frames
      await vi.waitFor(() => expect(got).toHaveLength(2));
      expect(got.map((b) => b.length)).toEqual([640, 640]); // two 80ms chunks, one frame still held
      stream.close();
      await vi.waitFor(() => expect(texts).toContain(JSON.stringify({ type: "CloseStream" })));
      expect(got.at(-1)!.length).toBe(160); // the held frame went out before closing
      expect(auth).toBe("Token key");
      expect(path).toMatch(/^\/v2\/listen\?model=flux-general-en/);
      await vi.waitFor(() => expect(h.onFinal).toHaveBeenCalledWith("Thursday at three"));
      expect(h.onEndOfTurn).toHaveBeenCalled();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("listening for the answer to what was just asked", () => {
  const base = { eotThreshold: 0.8, eagerEotThreshold: 0.5, eotTimeoutMs: 6000, numerals: false };

  it("is patient, with digits, while they give a number", () => {
    expect(listeningFor("Thanks. What's the best number to reach you on?", base)).toEqual({
      eotThreshold: 0.9,
      eagerEotThreshold: 0.85,
      eotTimeoutMs: 8000,
      numerals: true,
    });
    expect(listeningFor("Do you have the booking number from your text?", base).numerals).toBe(true);
  });

  it("is patient, without digits, while they spell something", () => {
    expect(listeningFor("Sorry, could you spell that for me?", base)).toMatchObject({ eotThreshold: 0.9, numerals: false });
  });

  it("is quick for a yes or no", () => {
    expect(listeningFor("That's a blow dry with Jo, Tuesday at 2, for Sam. Shall I book it?", base)).toMatchObject({ eotThreshold: 0.7, numerals: false });
    expect(listeningFor("That's booked, and a text is on its way. Anything else?", base).eotThreshold).toBe(0.7);
  });

  it("is the normal way for anything else", () => {
    expect(listeningFor("Which day would suit you?", base)).toBe(base);
    expect(listeningFor("Tomorrow at ten, or at quarter to twelve?", base)).toBe(base);
    // Shaped like a yes or no, but answered with a pause: "My name is… Roy".
    expect(listeningFor("Can I take your name?", base)).toBe(base);
  });

  it("goes to Flux as a Configure message, never asking for an early start surer than the end", () => {
    expect(JSON.parse(fluxConfigureMessage({ eotThreshold: 0.7, eagerEotThreshold: 0.85, eotTimeoutMs: 6000, numerals: false }))).toEqual({
      type: "Configure",
      thresholds: { eot_threshold: 0.7, eot_timeout_ms: 6000, eager_eot_threshold: 0.7 },
      numerals: false,
    });
    expect(JSON.parse(fluxConfigureMessage({ eotThreshold: 0.9, eagerEotThreshold: null, eotTimeoutMs: 8000, numerals: true })).thresholds).not.toHaveProperty("eager_eot_threshold");
  });

  it("is sent after a reply, only when it changes", async () => {
    const configure = vi.fn();
    const { client } = model(["What's the best number to reach you on?", "Thanks.", "Which day would suit you?"]);
    const engine = new ReceptionistEngine({
      client,
      model: "test",
      system: [{ type: "text", text: "sys" }],
      tools: [],
      execute: vi.fn<ToolExecutor>(async () => ({ ok: true })),
    });
    engine.messages.push({ role: "user", content: "[The call has connected.]" }, { role: "assistant", content: "Hi." });
    let h: SttHandlers | null = null;
    let clock = 10_000;
    const call = new VoiceCall({
      engine,
      stt: {
        detectsTurns: true,
        async open(handlers) {
          h = handlers;
          return { send: vi.fn(), close: vi.fn(), configure };
        },
      },
      tts: {
        bytesPerSecond: 100,
        async *synth() {
          yield Buffer.alloc(100);
        },
      },
      out: { audio: vi.fn(), clear: vi.fn(), event: vi.fn() },
      greeting: "Hi.",
      now: () => clock,
      silence: null,
      listening: base,
    });
    await call.start();
    const turn = async (text: string) => {
      clock += 60_000;
      h!.onFinal(text);
      h!.onEndOfTurn();
      await tick();
    };
    await turn("I'd like a cut.");
    expect(configure).toHaveBeenLastCalledWith(expect.objectContaining({ numerals: true, eotThreshold: 0.9 }));
    await turn("07700 900123.");
    expect(configure).toHaveBeenLastCalledWith(base); // "Thanks." is nothing special: back to normal
    await turn("Tuesday.");
    expect(configure).toHaveBeenCalledTimes(2); // still normal: nothing sent
  });
});

describe("cutting in on Flux", () => {
  it("waits for Flux's StartOfTurn, Deepgram's barge-in signal, before stopping for words", async () => {
    const { client } = model(["We have Tuesday at nine, or Wednesday at two, or Thursday at ten."]);
    const engine = new ReceptionistEngine({
      client,
      model: "test",
      system: [{ type: "text", text: "sys" }],
      tools: [],
      execute: vi.fn<ToolExecutor>(async () => ({ ok: true })),
    });
    engine.messages.push({ role: "user", content: "[The call has connected.]" }, { role: "assistant", content: "Hi." });
    let h: SttHandlers | null = null;
    let clock = 10_000;
    const clear = vi.fn();
    const call = new VoiceCall({
      engine,
      stt: {
        detectsTurns: true,
        async open(handlers) {
          h = handlers;
          return { send: vi.fn(), close: vi.fn() };
        },
      },
      tts: {
        bytesPerSecond: 100,
        async *synth() {
          yield Buffer.alloc(1000); // ten seconds
        },
      },
      out: { audio: vi.fn(), clear, event: vi.fn() },
      greeting: "Hi.",
      now: () => clock,
      silence: null,
    });
    await call.start();
    await tick();
    clock += 60_000;
    h!.onFinal("What have you got?");
    h!.onEndOfTurn();
    await tick();
    clock += 1_000;

    h!.onInterim("Friday"); // words without Flux saying a turn began
    expect(clear).not.toHaveBeenCalled();
    h!.onStartOfTurn!("Friday");
    h!.onInterim("Friday");
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
