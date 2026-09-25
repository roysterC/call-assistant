"use client";

/**
 * Talk to the receptionist through the computer's microphone.
 *
 * The browser does the audio plumbing only: it records the microphone, turns
 * it into 16kHz 16-bit samples, sends them to the voice server, and plays the
 * voice that comes back in the order it arrives. Everything else — hearing,
 * deciding, speaking, being interrupted — happens on the server, the same as
 * it will on the phone.
 */

import { useEffect, useRef, useState } from "react";
import { Mic, PhoneOff, Send, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

type State = "idle" | "connecting" | "listening" | "thinking" | "speaking";

type Line =
  | { kind: "caller"; text: string; final: boolean }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string }
  | { kind: "note"; text: string };

const RATE = 16000;

/**
 * Runs in the audio thread. Averages the microphone down to 16kHz and posts
 * 20ms frames of 16-bit samples, which is what the recogniser is sent.
 */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${RATE};
    this.next = this.step;
    this.pos = 0; this.sum = 0; this.n = 0;
    this.frame = new Int16Array(${RATE / 50}); this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.pos++;
      if (this.pos >= this.next) {
        const v = Math.max(-1, Math.min(1, this.sum / this.n));
        this.frame[this.fill++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.sum = 0; this.n = 0; this.next += this.step;
        if (this.fill === this.frame.length) {
          this.port.postMessage(this.frame.buffer.slice(0));
          this.fill = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
`;

const STATE_LABEL: Record<State, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export function VoiceLab({ callerNumber }: { callerNumber: string }) {
  const [state, setState] = useState<State>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [fakes, setFakes] = useState(false);
  const [pretend, setPretend] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const playing = useRef<AudioBufferSourceNode[]>([]);
  const nextStart = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  // Hang up if the page is left mid-call.
  useEffect(() => () => teardown(), []);

  function teardown() {
    ws.current?.close();
    ws.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    playing.current = [];
  }

  function stopPlayback() {
    for (const s of playing.current) {
      try {
        s.stop();
      } catch {
        // Already finished.
      }
    }
    playing.current = [];
    nextStart.current = 0;
  }

  function play(data: ArrayBuffer) {
    const ac = ctx.current;
    if (!ac) return;
    const pcm = new Int16Array(data);
    if (!pcm.length) return;
    const buf = ac.createBuffer(1, pcm.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    // Queued back to back, so sentences arriving in pieces play seamlessly.
    const at = Math.max(ac.currentTime + 0.02, nextStart.current);
    src.start(at);
    nextStart.current = at + buf.duration;
    playing.current.push(src);
    src.onended = () => {
      playing.current = playing.current.filter((s) => s !== src);
    };
  }

  async function start() {
    setError(null);
    setLines([]);
    setLatencies([]);
    setState("connecting");
    try {
      const res = await apiFetch("/api/receptionist/voice-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the call.");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mic.current = stream;
      const ac = new AudioContext();
      ctx.current = ac;
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      await ac.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ac, "capture");
      ac.createMediaStreamSource(stream).connect(node);

      const sock = new WebSocket(data.url);
      sock.binaryType = "arraybuffer";
      ws.current = sock;
      node.port.onmessage = (e) => {
        if (sock.readyState === WebSocket.OPEN) sock.send(e.data as ArrayBuffer);
      };
      sock.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) return play(e.data);
        const msg = JSON.parse(e.data as string);
        switch (msg.type) {
          case "hello":
            setFakes(Boolean(msg.fakes));
            setLines([
              { kind: "note", text: data.callerNumber ? `Call from ${data.callerNumber}` : "Call from a withheld number" },
              ...(msg.keySource
                ? [
                    {
                      kind: "note" as const,
                      text: msg.keySource === "salon" ? "Charged to this salon's own API key" : "Charged to the shared API key",
                    },
                  ]
                : []),
            ]);
            break;
          case "state":
            setState(msg.state);
            break;
          case "clear":
            stopPlayback();
            break;
          case "interrupted":
            setLines((ls) => [...ls, { kind: "note", text: "Interrupted" }]);
            break;
          case "caller":
            // One line for what is being heard now: earlier partial versions
            // of it are replaced, wherever they ended up.
            setLines((ls) => [
              ...ls.filter((l) => !(l.kind === "caller" && !l.final)),
              { kind: "caller", text: msg.text, final: msg.final },
            ]);
            break;
          case "assistant":
            setLines((ls) => [...ls, { kind: "assistant", text: msg.text }]);
            break;
          case "tool":
            setLines((ls) => [...ls, { kind: "tool", name: msg.name }]);
            break;
          case "metrics":
            if (msg.firstAudioMs != null) setLatencies((l) => [...l, msg.firstAudioMs]);
            break;
          case "error":
            setError(msg.message);
            break;
        }
      };
      // The server's own explanation, when it sends one, is the message to
      // show; the close code is the fallback when the line simply dropped.
      let explained = false;
      const onMessage = sock.onmessage;
      sock.onmessage = (e) => {
        if (typeof e.data === "string" && e.data.includes('"type":"error"')) explained = true;
        return onMessage?.call(sock, e);
      };
      sock.onclose = (e) => {
        if (!explained && e.code !== 1000 && e.code !== 1005) {
          setError(
            `The voice server closed the connection (code ${e.code}${e.reason ? `: ${e.reason}` : ""}).` +
              (e.code === 1006 ? " It may have restarted, or the web server isn't passing /voice/ through." : "")
          );
        }
        setState("idle");
        setLines((ls) => [...ls, { kind: "note", text: "Call ended" }]);
        teardown();
      };
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "The browser wasn't allowed to use the microphone."
          : err instanceof Error
            ? err.message
            : "Could not start the call."
      );
      setState("idle");
      teardown();
    }
  }

  function hangUp() {
    try {
      ws.current?.send(JSON.stringify({ type: "hangup" }));
    } catch {
      // Closing anyway.
    }
    teardown();
    setState("idle");
  }

  const live = state !== "idle";
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {live ? (
          <Button variant="outline" className="gap-1.5" onClick={hangUp}>
            <PhoneOff className="h-4 w-4" />
            Hang up
          </Button>
        ) : (
          <Button className="gap-1.5" onClick={start}>
            <Mic className="h-4 w-4" />
            Start talking
          </Button>
        )}
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
            state === "speaking"
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : state === "thinking"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : state === "listening"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-border bg-muted text-muted-foreground"
          )}
          aria-live="polite"
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              state === "speaking" ? "bg-indigo-500 animate-pulse" : state === "thinking" ? "bg-amber-500 animate-pulse" : state === "listening" ? "bg-emerald-500" : "bg-slate-300"
            )}
          />
          {STATE_LABEL[state]}
        </span>
        {avg !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            First sound after you stop: {(avg / 1000).toFixed(2)}s on average over {latencies.length}{" "}
            {latencies.length === 1 ? "reply" : "replies"}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="min-h-[40vh] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-card px-4 py-5 space-y-3">
        {lines.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Press Start talking and allow the microphone. Headphones stop the receptionist hearing
            itself through your speakers.
          </p>
        )}
        {lines.map((line, i) =>
          line.kind === "note" ? (
            <p key={i} className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
              {line.text}
            </p>
          ) : line.kind === "tool" ? (
            <p key={i} className="mx-auto flex w-fit items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
              <Wrench className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono">{line.name}</span>
            </p>
          ) : line.kind === "caller" ? (
            <div key={i} className="flex justify-end">
              <p
                className={cn(
                  "max-w-[min(75%,52ch)] rounded-2xl rounded-br-md px-4 py-2.5 text-sm",
                  line.final ? "bg-primary text-primary-foreground" : "bg-primary/10 text-foreground italic"
                )}
              >
                {line.text}
              </p>
            </div>
          ) : (
            <div key={i} className="flex">
              <p className="max-w-[min(75%,52ch)] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5 text-sm">
                {line.text}
              </p>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      {fakes && live && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pretend.trim()) return;
            ws.current?.send(JSON.stringify({ type: "say", text: pretend.trim() }));
            setPretend("");
          }}
        >
          <Input
            value={pretend}
            onChange={(e) => setPretend(e.target.value)}
            placeholder="Stand-in recogniser: type what it should hear"
            aria-label="Pretend the caller said"
          />
          <Button type="submit" variant="outline" className="gap-1.5">
            <Send className="h-4 w-4" />
            Hear
          </Button>
        </form>
      )}
    </div>
  );
}
