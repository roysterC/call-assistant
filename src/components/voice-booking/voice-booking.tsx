"use client";

/**
 * Booking by voice, in the diary.
 *
 * Tap the microphone and say it: "Sarah Jones, cut and finish, Thursday at
 * two". The words appear as they are heard; the assistant finds the client
 * and puts a card on screen; saying "yes" or tapping Save puts it in the
 * diary. Nothing is saved before that. "Make that half two" redraws the
 * card; "no" drops it. Moves and cancels work the same way.
 *
 * The panel floats over the diary rather than covering it, so the day stays
 * in view while you talk. A box to type into does the same job for a noisy
 * salon or a browser without a microphone.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Loader2, Mic, MicOff, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { CAPTURE_WORKLET, MIC_RATE } from "@/components/receptionist/capture-worklet";

export interface VoiceDraft {
  id: string;
  kind: "book" | "move" | "cancel";
  clientName: string;
  service: string;
  stylist: string;
  date: string;
  day: string;
  time: string;
  newClient: boolean;
  phone: string | null;
  skinTest: boolean;
  notes: string | null;
  from: { day: string; time: string; stylist: string } | null;
}

type Line = { who: "you" | "assistant"; text: string };

interface Reply {
  sessionId?: string;
  reply?: string;
  draft?: VoiceDraft | null;
  saved?: boolean;
  result?: { kind: string; appointmentId: string; startsAt: string; stylist: string };
  error?: string;
}

const KIND_LABEL = { book: "New booking", move: "Move booking", cancel: "Cancel booking" } as const;

export function VoiceBooking({
  onSaved,
}: {
  /** A booking was saved, moved or cancelled: the diary should reload (and show that day). */
  onSaved: (r: { date: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [heard, setHeard] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const session = useRef<string | undefined>(undefined);
  const draftRef = useRef<VoiceDraft | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines, draft, heard]);
  // Stop the microphone if the page is left while listening.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stopListening(), []);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  async function send(text: string, action?: "save" | "discard") {
    setError(null);
    if (text) setLines((l) => [...l, { who: "you", text }]);
    setBusy(true);
    try {
      const res = await apiFetch("/api/voice-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action ? { sessionId: session.current, action } : { sessionId: session.current, text }),
      });
      const data = (await res.json()) as Reply;
      if (data.sessionId) session.current = data.sessionId;
      if (!res.ok) {
        setError(data.error ?? "That didn't work.");
        return;
      }
      if (data.reply) setLines((l) => [...l, { who: "assistant", text: data.reply! }]);
      const saving = draftRef.current;
      setDraft(data.draft ?? null);
      if (data.saved && data.result) {
        onSaved({ date: saving?.date ?? data.result.startsAt.slice(0, 10) });
        // Done: stop listening shortly after, as the person would.
        setTimeout(() => stopListening(), 1500);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function startListening() {
    setError(null);
    setConnecting(true);
    try {
      const res = await apiFetch("/api/voice-booking/token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Voice isn't available.");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mic.current = stream;
      const ac = new AudioContext();
      ctx.current = ac;
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      await ac.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ac, "capture", { processorOptions: { rate: MIC_RATE, mulaw: false } });
      ac.createMediaStreamSource(stream).connect(node);

      const sock = new WebSocket(data.url);
      sock.binaryType = "arraybuffer";
      ws.current = sock;
      node.port.onmessage = (e) => {
        if (sock.readyState === WebSocket.OPEN) sock.send(e.data as ArrayBuffer);
      };
      sock.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        const msg = JSON.parse(e.data);
        // The voice server is ready to hear; audio sent before now is held
        // for it, so nothing said while it connected is lost.
        if (msg.type === "hello") {
          setConnecting(false);
          setListening(true);
        }
        if (msg.type === "heard") setHeard(msg.text);
        if (msg.type === "utterance") {
          setHeard("");
          void send(msg.text);
        }
        if (msg.type === "error") setError(msg.message);
      };
      sock.onclose = () => {
        teardownAudio();
        setListening(false);
        setConnecting(false);
        setHeard("");
      };
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "The browser wasn't allowed to use the microphone. You can type instead."
          : err instanceof Error
            ? err.message
            : "Couldn't start listening."
      );
      setConnecting(false);
      teardownAudio();
    }
  }

  /** Stop, keeping whatever was said so far. */
  function stopListening() {
    const sock = ws.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "stop" }));
    } else {
      sock?.close();
    }
    ws.current = null;
    teardownAudio();
    setListening(false);
  }

  function teardownAudio() {
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
  }

  function close() {
    stopListening();
    if (session.current) {
      void apiFetch(`/api/voice-booking?sessionId=${encodeURIComponent(session.current)}`, { method: "DELETE" });
    }
    session.current = undefined;
    setOpen(false);
    setLines([]);
    setDraft(null);
    setError(null);
  }

  function openAndListen() {
    setOpen(true);
    void startListening();
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => (open ? close() : openAndListen())}>
        <Mic className="h-3.5 w-3.5" />
        Book by voice
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Book by voice"
          className="fixed z-40 inset-x-2 bottom-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px] max-h-[75vh] flex flex-col rounded-xl border border-border bg-card shadow-raised"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="font-heading text-sm font-semibold">Book by voice</span>
            <span
              className={cn(
                "ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                listening ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
              )}
              aria-live="polite"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", listening ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
              {connecting ? "Starting…" : listening ? "Listening" : "Not listening"}
            </span>
            <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={close}>
              <X />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[120px]">
            {lines.length === 0 && !heard && (
              <p className="text-sm text-muted-foreground">
                Say it as you would to a colleague: <em>&ldquo;Sarah Jones, cut and finish, Thursday at two.&rdquo;</em>{" "}
                Or <em>&ldquo;move Tom to Friday&rdquo;</em>. Nothing is saved until you say yes.
              </p>
            )}
            {lines.map((l, i) =>
              l.who === "you" ? (
                <p key={i} className="ml-8 rounded-lg bg-primary/10 px-3 py-2 text-sm">
                  {l.text}
                </p>
              ) : (
                <p key={i} className="mr-8 text-sm">
                  {l.text}
                </p>
              )
            )}
            {heard && <p className="ml-8 rounded-lg border border-dashed border-primary/30 px-3 py-2 text-sm italic text-muted-foreground">{heard}</p>}
            {busy && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the diary…
              </p>
            )}

            {draft && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3" data-testid="voice-draft">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  <CalendarCheck className="h-3.5 w-3.5" />
                  {KIND_LABEL[draft.kind]}
                </p>
                <p className="font-medium">
                  {draft.clientName}
                  {draft.newClient && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">New client</span>
                  )}
                </p>
                <p className="text-sm">{draft.service}</p>
                {draft.from && (
                  <p className="text-sm text-muted-foreground line-through">
                    {draft.from.day}, {draft.from.time} · {draft.from.stylist}
                  </p>
                )}
                <p className={cn("text-sm", draft.kind === "cancel" && "line-through text-muted-foreground")}>
                  {draft.day}, {draft.time} · {draft.stylist}
                </p>
                {draft.phone && <p className="text-xs text-muted-foreground">{draft.phone}</p>}
                {draft.skinTest && <p className="mt-1 text-xs font-medium text-amber-800">Skin test needed 48 hours before</p>}
                {draft.notes && <p className="mt-1 text-xs text-muted-foreground">{draft.notes}</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void send("", "save")}>
                    {draft.kind === "cancel" ? "Cancel booking" : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void send("", "discard")}>
                    Not this
                  </Button>
                  <span className="ml-auto self-center text-[11px] text-muted-foreground">or say &ldquo;yes&rdquo;</span>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const t = typed.trim();
              if (!t || busy) return;
              setTyped("");
              void send(t);
            }}
          >
            <Button
              type="button"
              size="icon-sm"
              variant={listening ? "default" : "outline"}
              aria-label={listening ? "Stop listening" : "Start listening"}
              onClick={() => (listening || connecting ? stopListening() : void startListening())}
            >
              {listening ? <MicOff /> : <Mic />}
            </Button>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Or type it…"
              aria-label="Type a booking"
              className="h-8"
            />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label="Send" disabled={!typed.trim() || busy}>
              <Send />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
