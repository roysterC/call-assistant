"use client";

/**
 * The personal assistant, on every page.
 *
 * Tap it and talk: "what's my afternoon looking like?", "Sarah Jones, cut and
 * finish, Thursday at two, and text her", "how much did we take last week?".
 * The words appear as they are heard. Questions are answered; anything that
 * would change something (a booking, a move, a note, a text) becomes a card,
 * and nothing happens until "yes" or a tap on the card's button.
 *
 * Replies are read aloud in the device's own British voice, so it works with
 * hands full, and the microphone pauses while it speaks so it does not hear
 * itself. The panel floats over the page rather than covering it; a box to
 * type into does the same job in a noisy salon.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Loader2, MessageSquareText, Mic, MicOff, NotebookPen, Send, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { CAPTURE_WORKLET, MIC_RATE } from "@/components/receptionist/capture-worklet";

export interface VoiceDraft {
  id: string;
  kind: "book" | "move" | "cancel" | "note" | "text";
  clientName: string;
  // Bookings, moves and cancellations.
  service?: string;
  stylist?: string;
  date?: string;
  day?: string;
  time?: string;
  newClient?: boolean;
  phone?: string | null;
  skinTest?: boolean;
  notes?: string | null;
  from?: { day: string; time: string; stylist: string } | null;
  textTo?: { number: string; name: string | null } | null;
  // A note, or a text of its own.
  note?: string;
  to?: string;
  body?: string;
}

/** Tells any open diary that it has changed, so it reloads (and can show the day). */
export const DIARY_CHANGED = "kikai:diary-changed";

type Line = { who: "you" | "assistant"; text: string };

interface Reply {
  sessionId?: string;
  reply?: string;
  draft?: VoiceDraft | null;
  saved?: boolean;
  result?: { kind: string; appointmentId: string; startsAt: string; stylist: string };
  error?: string;
}

const KIND_LABEL = {
  book: "New booking",
  move: "Move booking",
  cancel: "Cancel booking",
  note: "Add a note",
  text: "Send a text",
} as const;
const SAVE_LABEL = { book: "Save", move: "Save", cancel: "Cancel booking", note: "Add note", text: "Send text" } as const;

const SPEAK_KEY = "kikai.assistant.speak";

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [heard, setHeard] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [speakReplies, setSpeakReplies] = useState(true);
  /** The browser wants a touch before it will use the microphone. */
  const [needsTap, setNeedsTap] = useState(false);
  const speaking = useRef(false);

  // Opened by /assistant (Siri, Google Assistant, the app icon): start
  // listening straight away, and take the flag off the address so a reload
  // does not start it again. This stays mounted while /assistant hands on to
  // the start page, so it looks again each time the page changes.
  const pathname = usePathname();
  const arrived = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("assistant") !== "listen") return;
    url.searchParams.delete("assistant");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setOpen(true);
    // The start page may pass the flag on once more; one microphone is enough.
    if (arrived.current) return;
    arrived.current = true;
    setTimeout(() => (arrived.current = false), 5000);
    void startListening({ unprompted: true });
    // Only the arrival on a new page matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Remembered per browser; a browser that refuses storage just speaks.
  useEffect(() => {
    try {
      if (localStorage.getItem(SPEAK_KEY) === "off") setSpeakReplies(false);
    } catch {
      // Storage refused: keep the default.
    }
  }, []);
  function toggleSpeak() {
    const next = !speakReplies;
    setSpeakReplies(next);
    if (!next) stopSpeaking();
    try {
      localStorage.setItem(SPEAK_KEY, next ? "on" : "off");
    } catch {
      // Not remembered, still toggled.
    }
  }

  /** Read a reply aloud, with the microphone paused so it does not hear itself. */
  function speak(text: string) {
    if (!speakReplies || typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const british = voices.find((v) => v.lang === "en-GB" && /female|serena|kate|libby|sonia/i.test(v.name)) ?? voices.find((v) => v.lang === "en-GB");
    if (british) u.voice = british;
    u.lang = "en-GB";
    u.rate = 1;
    speaking.current = true;
    const done = () => {
      // A moment's grace for the last of it to leave the speaker.
      setTimeout(() => (speaking.current = false), 300);
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  }
  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    speaking.current = false;
  }

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
      if (data.reply) {
        setLines((l) => [...l, { who: "assistant", text: data.reply! }]);
        speak(data.reply);
      }
      const saving = draftRef.current;
      setDraft(data.draft ?? null);
      if (data.saved && data.result && saving && ["book", "move", "cancel"].includes(saving.kind)) {
        window.dispatchEvent(new CustomEvent(DIARY_CHANGED, { detail: { date: saving.date } }));
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function startListening(opts: { unprompted?: boolean } = {}) {
    setError(null);
    setNeedsTap(false);
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
      // Opened without a touch (by Siri, say), a browser may hold audio back
      // until the person taps. Ask once; if it still will not start, show
      // one big "tap to talk" rather than failing quietly.
      if (ac.state === "suspended") {
        await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
        if (ac.state === "suspended") {
          if (!opts.unprompted) throw new Error("The browser would not start the microphone. Tap the microphone to try again.");
          teardownAudio();
          setConnecting(false);
          setNeedsTap(true);
          return;
        }
      }
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      await ac.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ac, "capture", { processorOptions: { rate: MIC_RATE, mulaw: false } });
      ac.createMediaStreamSource(stream).connect(node);

      const sock = new WebSocket(data.url);
      sock.binaryType = "arraybuffer";
      ws.current = sock;
      node.port.onmessage = (e) => {
        // Not while the assistant is talking: it would hear itself.
        if (speaking.current) return;
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
    stopSpeaking();
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
      {!open && (
        <button
          type="button"
          onClick={openAndListen}
          aria-label="Ask your assistant"
          title="Ask your assistant"
          className="fixed z-30 right-4 bottom-4 sm:right-6 sm:bottom-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-raised flex items-center justify-center hover:brightness-110 active:scale-95 transition"
        >
          <Mic className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Your assistant"
          className="fixed z-40 inset-x-2 bottom-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px] max-h-[75vh] flex flex-col rounded-xl border border-border bg-card shadow-raised"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-heading text-sm font-semibold">Your assistant</span>
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
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={speakReplies ? "Stop reading replies aloud" : "Read replies aloud"}
              aria-pressed={speakReplies}
              onClick={toggleSpeak}
            >
              {speakReplies ? <Volume2 /> : <VolumeX />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
              <X />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[120px]">
            {needsTap && (
              <button
                type="button"
                onClick={() => void startListening()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 py-8 text-primary"
              >
                <Mic className="h-10 w-10" />
                <span className="font-heading text-base font-semibold">Tap to talk</span>
                <span className="text-xs text-muted-foreground">Your browser needs a tap before it will listen.</span>
              </button>
            )}
            {lines.length === 0 && !heard && !needsTap && (
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p>Ask it anything, or tell it what to do:</p>
                <p>
                  <em>&ldquo;What&rsquo;s my afternoon looking like?&rdquo;</em>
                  <br />
                  <em>&ldquo;Sarah Jones, cut and blow dry, Thursday at two, and text her.&rdquo;</em>
                  <br />
                  <em>&ldquo;When was Tom last in?&rdquo;</em> <em>&ldquo;How much did we take this week?&rdquo;</em>
                </p>
                <p>Nothing is booked, changed or sent until you say yes.</p>
              </div>
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
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </p>
            )}

            {draft && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3" data-testid="voice-draft">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {draft.kind === "note" ? (
                    <NotebookPen className="h-3.5 w-3.5" />
                  ) : draft.kind === "text" ? (
                    <MessageSquareText className="h-3.5 w-3.5" />
                  ) : (
                    <CalendarCheck className="h-3.5 w-3.5" />
                  )}
                  {KIND_LABEL[draft.kind]}
                </p>
                <p className="font-medium">
                  {draft.clientName}
                  {draft.newClient && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">New client</span>
                  )}
                </p>
                {draft.kind === "note" && <p className="mt-1 text-sm italic">&ldquo;{draft.note}&rdquo;</p>}
                {draft.kind === "text" && (
                  <>
                    <p className="text-xs text-muted-foreground">To {draft.to}</p>
                    <p className="mt-1.5 rounded-lg bg-card border border-border px-3 py-2 text-sm">{draft.body}</p>
                  </>
                )}
                {draft.service && <p className="text-sm">{draft.service}</p>}
                {draft.from && (
                  <p className="text-sm text-muted-foreground line-through">
                    {draft.from.day}, {draft.from.time} · {draft.from.stylist}
                  </p>
                )}
                {draft.day && (
                  <p className={cn("text-sm", draft.kind === "cancel" && "line-through text-muted-foreground")}>
                    {draft.day}, {draft.time} · {draft.stylist}
                  </p>
                )}
                {draft.phone && <p className="text-xs text-muted-foreground">{draft.phone}</p>}
                {draft.skinTest && <p className="mt-1 text-xs font-medium text-amber-800">Skin test needed 48 hours before</p>}
                {draft.notes && <p className="mt-1 text-xs text-muted-foreground">{draft.notes}</p>}
                {draft.textTo && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquareText className="h-3 w-3" />
                    Texts {draft.textTo.name ?? "them"} on {draft.textTo.number}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void send("", "save")}>
                    {SAVE_LABEL[draft.kind]}
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
              onClick={() => {
                stopSpeaking();
                if (listening || connecting) stopListening();
                else void startListening();
              }}
            >
              {listening ? <MicOff /> : <Mic />}
            </Button>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Or type it…"
              aria-label="Type to your assistant"
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
