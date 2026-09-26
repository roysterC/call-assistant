/**
 * The voice server: live audio in and out for our own receptionist.
 *
 * A separate process from the CRM on purpose. A call is a connection held open
 * for minutes; the CRM restarts on every deploy. Kept apart, shipping a change
 * to the diary does not hang up on anyone mid-booking.
 *
 * Step 2 serves the browser lab (`/voice/lab`): the CRM signs a short-lived
 * pass, the browser opens a websocket here with it, sends microphone audio up
 * and plays the receptionist's voice as it comes down. The phone line (step 3)
 * joins as a second path on the same server.
 *
 *   npx tsx src/voice-server/index.ts
 *
 * Needs, from .env.local / .env: DATABASE_URL, DEEPGRAM_API_KEY,
 * ELEVENLABS_API_KEY and RECEPTIONIST_VOICE_SECRET (the same value the CRM
 * signs passes with), plus an Anthropic key: the salon's own override if it
 * has one, else ANTHROPIC_API_KEY. VOICE_PORT defaults to 4610.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { AudioEncoding } from "@/lib/receptionist/voice/providers";

const PORT = Number(process.env.VOICE_PORT || 4610);
const HOST = process.env.VOICE_HOST || "127.0.0.1";
const MAX_LAB_CALLS = 5;
const MAX_CALL_MS = 15 * 60 * 1000;
const FAKES = process.env.VOICE_FAKES === "1" && process.env.NODE_ENV !== "production";

async function main() {
  // Imported after the environment is loaded: these read it at import time.
  const { prisma } = await import("@/lib/prisma");
  const { receptionistApiKey, startReceptionist } = await import("@/lib/receptionist/session");
  const { verifyVoicePass } = await import("@/lib/receptionist/voice/token");
  const { VoiceCall } = await import("@/lib/receptionist/voice/call");
  const { recordUsage } = await import("@/lib/usage/record");
  const { DeepgramStt, ElevenLabsTts, labVoiceRate } = await import("@/lib/receptionist/voice/providers");
  const fakes = FAKES ? await import("./fakes") : null;

  const secret = process.env.RECEPTIONIST_VOICE_SECRET ?? "";
  if (!secret) console.warn("[VOICE] RECEPTIONIST_VOICE_SECRET is not set; every connection will be refused.");
  if (FAKES) console.warn("[VOICE] VOICE_FAKES=1: using stand-in model, recogniser and voice.");

  let labCalls = 0;
  /** Caller audio received since start: a quick check that microphones are getting through. */
  let audioBytesIn = 0;

  const server = http.createServer((req, res) => {
    if (req.url === "/voice/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      // activeCalls is what the deploy waits on before restarting this
      // server; the phone line adds its calls to it in step 3.
      res.end(JSON.stringify({ ok: true, activeCalls: labCalls, labCalls, audioBytesIn, fakes: FAKES }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://voice.local");
    if (url.pathname !== "/voice/lab") return socket.destroy();
    const pass = verifyVoicePass(url.searchParams.get("token") ?? "", secret);
    wss.handleUpgrade(req, socket, head, (ws) => {
      // A refused pass is still answered over the socket, with the reason:
      // a browser cannot read the status of a failed upgrade, so a bare 401
      // only ever reached the page as "lost the connection".
      if (!pass) {
        const reason = secret
          ? "The voice server refused the pass. The CRM and the voice server need the same RECEPTIONIST_VOICE_SECRET; restart both after changing it."
          : "The voice server has no RECEPTIONIST_VOICE_SECRET. Add it to .env and restart call-assistant-voice.";
        console.warn(`[VOICE] refused a pass: ${secret ? "did not verify" : "no secret set"}`);
        sendJson(ws, { type: "error", message: reason });
        return ws.close(4401, "pass refused");
      }
      // "phone" makes the voice as the phone line will: 8kHz mu-law, so the
      // lab can be heard the way a caller will hear it.
      const sound = url.searchParams.get("sound") === "phone" ? "phone" : "clear";
      void runLabCall(ws, pass, sound).catch((err) => {
        console.error("[VOICE] lab call failed:", err);
        sendJson(ws, {
          type: "error",
          message: `The call could not start: ${err instanceof Error ? err.message : String(err)}`,
        });
        ws.close(4500, "call failed");
      });
    });
  });

  async function runLabCall(
    ws: WebSocket,
    pass: { organizationId: string; callerNumber: string | null },
    sound: "clear" | "phone"
  ) {
    if (labCalls >= MAX_LAB_CALLS) {
      sendJson(ws, { type: "error", message: "Too many lab calls at once. Try again shortly." });
      return ws.close();
    }
    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: pass.organizationId },
      select: { voiceEnabled: true },
    });
    if (!settings?.voiceEnabled) {
      sendJson(ws, { type: "error", message: "The voice agent is switched off for this salon." });
      return ws.close();
    }

    const missing = FAKES
      ? []
      : [
          ...((await receptionistApiKey(pass.organizationId)) ? [] : ["an Anthropic API key"]),
          ...["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"].filter((k) => !process.env[k]),
        ];
    if (missing.length) {
      sendJson(ws, { type: "error", message: `The voice server is missing ${missing.join(", ")}.` });
      return ws.close();
    }

    // The microphone comes in at 16kHz, all the recogniser needs. The voice
    // goes out at its own rate: clearer than that in the lab, or exactly what
    // the phone line will carry when previewing a call.
    const encoding = { kind: "pcm16", sampleRate: 16000 } as const;
    const voiceEncoding: AudioEncoding =
      sound === "phone"
        ? { kind: "mulaw8k" }
        : { kind: "pcm16", sampleRate: labVoiceRate(process.env.ELEVENLABS_LAB_SAMPLE_RATE) };
    const fakeStt = fakes ? new fakes.FakeStt() : null;
    const stt =
      fakeStt ??
      new DeepgramStt(process.env.DEEPGRAM_API_KEY!, encoding, {
        model: process.env.DEEPGRAM_MODEL || undefined,
        language: process.env.DEEPGRAM_LANGUAGE || undefined,
        endpointingMs: process.env.DEEPGRAM_ENDPOINTING_MS ? Number(process.env.DEEPGRAM_ENDPOINTING_MS) : undefined,
      });
    const tts = fakes
      ? new fakes.FakeTts(voiceEncoding)
      : new ElevenLabsTts(process.env.ELEVENLABS_API_KEY!, voiceEncoding, {
          voiceId: process.env.ELEVENLABS_VOICE_ID || undefined,
          model: process.env.ELEVENLABS_MODEL || undefined,
          speed: process.env.ELEVENLABS_SPEED ? Number(process.env.ELEVENLABS_SPEED) : undefined,
        });

    const session = await startReceptionist(pass.organizationId, {
      callerNumber: pass.callerNumber,
      client: fakes ? fakes.fakeModel() : undefined,
    });

    const call = new VoiceCall({
      engine: session.engine,
      stt,
      tts,
      greeting: session.greeting,
      out: {
        audio: (chunk) => {
          if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
        },
        clear: () => sendJson(ws, { type: "clear" }),
        event: (e) => sendJson(ws, e),
      },
    });

    // The browser may have gone while the call was being set up; its close
    // event has then already fired and would never reach the handler below.
    if (ws.readyState !== ws.OPEN) return;

    // Counted from here, where the close handler that uncounts it is attached
    // in the same tick. The deploy waits on this number before restarting the
    // server, so it must never be left stuck above zero.
    labCalls++;
    const limit = setTimeout(() => ws.close(), MAX_CALL_MS);
    const ping = setInterval(() => ws.ping(), 20_000);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(limit);
      clearInterval(ping);
      call.close();
      labCalls--;
      // What this lab call cost us. Lab usage is never charged to the salon,
      // but it is on our bill, so it is counted.
      if (!fakes) {
        void recordUsage(pass.organizationId, {
          source: "lab_voice",
          startedAt: new Date(call.startedAt),
          durationSeconds: (Date.now() - call.startedAt) / 1000,
          counts: {
            model: session.model,
            ...call.tokenUsage(),
            sttSeconds: call.audioBytesIn / (encoding.sampleRate * 2),
            ttsCharacters: call.ttsCharacters,
          },
        });
      }
    };

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        audioBytesIn += (data as Buffer).length;
        return call.audioIn(data as Buffer);
      }
      let msg: { type?: string; text?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "hangup") ws.close();
      // Stand-in recogniser only: the page types what it would have heard.
      if (msg.type === "say" && fakeStt && typeof msg.text === "string") fakeStt.say(msg.text.slice(0, 500));
    });
    ws.on("close", end);
    ws.on("error", end);

    sendJson(ws, {
      type: "hello",
      model: session.model,
      keySource: session.keySource,
      fakes: FAKES,
      voice:
        voiceEncoding.kind === "mulaw8k"
          ? { encoding: "mulaw", sampleRate: 8000 }
          : { encoding: "pcm16", sampleRate: voiceEncoding.sampleRate },
    });
    await call.start();
  }

  server.listen(PORT, HOST, () => console.log(`[VOICE] listening on ${HOST}:${PORT}`));
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
