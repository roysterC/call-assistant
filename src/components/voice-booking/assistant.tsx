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
 * itself. A phone only lets a page start speaking from inside a tap until it
 * has done so once, so every tap here unlocks speech first; and the pause
 * always lifts, even when the phone never plays a reply, or the microphone
 * would stay deaf until restarted. The panel floats over the page rather than covering it; a box to
 * type into does the same job in a noisy salon.
 */

import { useEffect, useRef, useState } from "react";
import {
  CalendarCheck,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  NotebookPen,
  Send,
  Sparkles,
  UserPen,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { CAPTURE_WORKLET, MIC_RATE } from "@/components/receptionist/capture-worklet";
import { useT } from "@/components/providers/language-provider";

export interface VoiceDraft {
  id: string;
  kind: "book" | "move" | "cancel" | "note" | "text" | "details";
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
  /** How many texts the body will be billed as. */
  segments?: number;
  // A change to the client's details, old beside new.
  changes?: { field: "name" | "phone" | "email" | "patchTest"; label: string; from: string | null; to: string }[];
}

/** Tells any open diary that it has changed, so it reloads (and can show the day). */
export const DIARY_CHANGED = "kikai:diary-changed";

/** Opens the assistant, listening: the phone's Assistant tab, which has no button of its own here. */
export const OPEN_ASSISTANT = "kikai:open-assistant";

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
  book: "assistant.kind.book",
  move: "assistant.kind.move",
  cancel: "assistant.kind.cancel",
  note: "assistant.kind.note",
  text: "assistant.kind.text",
  details: "assistant.kind.details",
} as const;
const SAVE_LABEL = {
  book: "assistant.save.book",
  move: "assistant.save.move",
  cancel: "assistant.save.cancel",
  note: "assistant.save.note",
  text: "assistant.save.text",
  details: "assistant.save.details",
} as const;

const SPEAK_KEY = "kikai.assistant.speak";

export function Assistant() {
  const { t, lang } = useT();
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
  // What speak() reads. The microphone's handlers are set up once, when it
  // starts, and kept the state of that moment: switching reading aloud on or
  // off mid-conversation did nothing to spoken questions until the
  // microphone was restarted.
  const speakRepliesRef = useRef(true);
  /** The browser wants a touch before it will use the microphone. */
  const [needsTap, setNeedsTap] = useState(false);
  const speaking = useRef(false);
  /** The utterance the pause belongs to, so an older one's timers cannot lift a newer one's. */
  const speech = useRef(0);
  const unlocked = useRef(false);
  const [silent, setSilent] = useState(false);

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
      if (localStorage.getItem(SPEAK_KEY) === "off") {
        speakRepliesRef.current = false;
        setSpeakReplies(false);
      }
    } catch {
      // Storage refused: keep the default.
    }
  }, []);
  function toggleSpeak() {
    const next = !speakRepliesRef.current;
    speakRepliesRef.current = next;
    setSpeakReplies(next);
    // A tap: the moment a phone allows speech to be unlocked.
    if (next) unlockSpeech();
    else stopSpeaking();
    try {
      localStorage.setItem(SPEAK_KEY, next ? "on" : "off");
    } catch {
      // Not remembered, still toggled.
    }
  }

  /**
   * Called from inside a tap. iPhones (and some Android browsers) let a page
   * start speaking only from a tap until it has spoken once; a reply arrives
   * seconds after the tap, so without this it was dropped without a sound.
   * A silent utterance here is that first time.
   */
  function unlockSpeech() {
    if (unlocked.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    unlocked.current = true;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  /** Read a reply aloud, with the microphone paused so it does not hear itself. */
  function speak(text: string) {
    if (!speakRepliesRef.current || typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    // A phone can leave speech paused after the page was in the background.
    synth.resume();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const british = voices.find((v) => v.lang === "en-GB" && /female|serena|kate|libby|sonia/i.test(v.name)) ?? voices.find((v) => v.lang === "en-GB");
    if (british) u.voice = british;
    u.lang = "en-GB";
    u.rate = 1;

    const id = ++speech.current;
    speaking.current = true;
    let started = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const lift = (graceMs: number) => {
      timers.forEach(clearTimeout);
      // A moment's grace for the last of it to leave the speaker.
      setTimeout(() => {
        if (speech.current === id) speaking.current = false;
      }, graceMs);
    };
    u.onstart = () => {
      started = true;
      setSilent(false);
    };
    u.onend = () => lift(300);
    u.onerror = () => lift(0);
    // The pause must always lift. A phone that will not play the reply fires
    // no event at all, and the microphone stayed deaf until restarted.
    timers.push(
      setTimeout(() => {
        if (started || speech.current !== id) return;
        setSilent(true);
        lift(0);
      }, 1500),
      // Never longer than the reply could take to say, with room to spare.
      setTimeout(() => lift(0), 4000 + text.length * 90)
    );
    synth.speak(u);
  }
  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    speech.current++;
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
        setError(data.error ?? t("assistant.errFailed"));
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
      setError(t("assistant.errServer"));
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
      if (!res.ok) throw new Error(data.error || t("assistant.errNoVoice"));

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
          if (!opts.unprompted) throw new Error(t("assistant.errMicStart"));
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
          ? t("assistant.errMicDenied")
          : err instanceof Error
            ? err.message
            : t("assistant.errListen")
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
    unlockSpeech();
    setOpen(true);
    void startListening();
  }

  // The phone's Assistant tab. Dispatched from its tap, so the browser still
  // counts the microphone and speech as asked for by the person.
  useEffect(() => {
    const onOpen = () => {
      if (!open) openAndListen();
    };
    window.addEventListener(OPEN_ASSISTANT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT, onOpen);
  });

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openAndListen}
          aria-label={t("assistant.open")}
          title={t("assistant.open")}
          // From md up; a phone has the Assistant tab in its bar instead.
          className="fixed z-30 right-6 bottom-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-raised hidden md:flex items-center justify-center hover:brightness-110 active:scale-95 transition"
        >
          <Mic className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={t("assistant.panel")}
          // Above the phone's tab bar; in the corner from md up.
          className="fixed z-40 inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-6 sm:w-[400px] md:bottom-6 max-h-[75vh] flex flex-col rounded-xl border border-border bg-card shadow-raised"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-heading text-sm font-semibold">{t("assistant.panel")}</span>
            <span
              className={cn(
                "ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                listening ? "bg-tea-green-800 text-tea-green-200" : "bg-muted text-muted-foreground"
              )}
              aria-live="polite"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", listening ? "bg-tea-green-300 animate-pulse" : "bg-tea-green-500")} />
              {connecting ? t("assistant.starting") : listening ? t("assistant.listening") : t("assistant.notListening")}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={speakReplies ? t("assistant.stopReading") : t("assistant.readAloud")}
              aria-pressed={speakReplies}
              onClick={toggleSpeak}
            >
              {speakReplies ? <Volume2 /> : <VolumeX />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={close}>
              <X />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[120px]">
            {needsTap && (
              <button
                type="button"
                onClick={() => {
                  unlockSpeech();
                  void startListening();
                }}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 py-8 text-primary"
              >
                <Mic className="h-10 w-10" />
                <span className="font-heading text-base font-semibold">{t("assistant.tapToTalk")}</span>
                <span className="text-xs text-muted-foreground">{t("assistant.needsTap")}</span>
              </button>
            )}
            {lines.length === 0 && !heard && !needsTap && (
              <div className="space-y-1.5 text-sm text-muted-foreground">
                {/* It understands English only so far: the examples stay English. */}
                <p>{lang === "vi" ? t("assistant.englishOnly") : t("assistant.intro")}</p>
                <p>
                  <em>&ldquo;What&rsquo;s my afternoon looking like?&rdquo;</em>
                  <br />
                  <em>&ldquo;Sarah Jones, cut and blow dry, Thursday at two, and text her.&rdquo;</em>
                  <br />
                  <em>&ldquo;When was Tom last in?&rdquo;</em> <em>&ldquo;How much did we take this week?&rdquo;</em>
                </p>
                <p>{t("assistant.nothingUntilYes")}</p>
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
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("assistant.thinking")}
              </p>
            )}

            {draft && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3" data-testid="voice-draft">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {draft.kind === "note" ? (
                    <NotebookPen className="h-3.5 w-3.5" />
                  ) : draft.kind === "text" ? (
                    <MessageSquareText className="h-3.5 w-3.5" />
                  ) : draft.kind === "details" ? (
                    <UserPen className="h-3.5 w-3.5" />
                  ) : (
                    <CalendarCheck className="h-3.5 w-3.5" />
                  )}
                  {t(KIND_LABEL[draft.kind])}
                </p>
                <p className="font-medium">
                  {draft.clientName}
                  {draft.newClient && (
                    <span className="ml-2 rounded bg-papaya-whip-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-papaya-whip-100">{t("assistant.newClient")}</span>
                  )}
                </p>
                {draft.kind === "note" && <p className="mt-1 text-sm italic">&ldquo;{draft.note}&rdquo;</p>}
                {draft.kind === "text" && (
                  <>
                    <p className="text-xs text-muted-foreground">{t("assistant.to", { number: draft.to ?? "" })}</p>
                    <p className="mt-1.5 rounded-lg bg-card border border-border px-3 py-2 text-sm">{draft.body}</p>
                    {(draft.segments ?? 1) > 1 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("assistant.segments", { n: draft.segments ?? 2 })}
                      </p>
                    )}
                  </>
                )}
                {draft.changes && (
                  <dl className="mt-1 space-y-1 text-sm">
                    {draft.changes.map((c) => (
                      <div key={c.field}>
                        <dt className="text-xs text-muted-foreground">{t(`assistant.field.${c.field}`)}</dt>
                        <dd>
                          {c.from && <span className="mr-2 text-muted-foreground line-through">{c.from}</span>}
                          <span className="font-medium break-all">{c.to}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
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
                {draft.skinTest && <p className="mt-1 text-xs font-medium text-papaya-whip-100">{t("assistant.skinTestNeeded")}</p>}
                {draft.notes && <p className="mt-1 text-xs text-muted-foreground">{draft.notes}</p>}
                {draft.textTo && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquareText className="h-3 w-3" />
                    {t("assistant.textsOn", { name: draft.textTo.name ?? t("assistant.them"), number: draft.textTo.number })}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      unlockSpeech();
                      void send("", "save");
                    }}
                  >
                    {t(SAVE_LABEL[draft.kind])}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      unlockSpeech();
                      void send("", "discard");
                    }}
                  >
                    {t("assistant.notThis")}
                  </Button>
                  <span className="ml-auto self-center text-[11px] text-muted-foreground">{t("assistant.orSayYes")}</span>
                </div>
              </div>
            )}
            {silent && speakReplies && (
              <p className="text-xs text-muted-foreground">{t("assistant.silent")}</p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              unlockSpeech();
              const said = typed.trim();
              if (!said || busy) return;
              setTyped("");
              void send(said);
            }}
          >
            <Button
              type="button"
              size="icon-sm"
              variant={listening ? "default" : "outline"}
              aria-label={listening ? t("assistant.stopListening") : t("assistant.startListening")}
              onClick={() => {
                stopSpeaking();
                unlockSpeech();
                if (listening || connecting) stopListening();
                else void startListening();
              }}
            >
              {listening ? <MicOff /> : <Mic />}
            </Button>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t("assistant.typePlaceholder")}
              aria-label={t("assistant.typeLabel")}
              className="h-8"
            />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label={t("assistant.send")} disabled={!typed.trim() || busy}>
              <Send />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
