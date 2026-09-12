"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, X, Send } from "lucide-react";
import { readableTextOn } from "@/lib/contrast";

interface Config {
  siteId: string;
  name: string;
  botName: string;
  greeting: string | null;
  quickReplies: string[];
  brandColor: string;
  enabled: boolean;
  launcherPosition: "left" | "right";
  launcherOffset: number;
  launcherLabel: string | null;
  launcherIcon: string | null;
  theme: "light" | "dark" | "auto";
  fontFamily: string;
  proactiveEnabled: boolean;
  proactiveMessage: string | null;
  proactiveDelaySeconds: number;
  proactiveCooldownHours: number;
  /**
   * Where to send a visitor who wants a person. The parent page does the
   * scrolling — see openCTA(). No label means no button.
   */
  ctaLabel: string | null;
  ctaSelector: string | null;
  ctaUrl: string | null;
  /** Attribution, resolved server-side from the org's plan. */
  branding?: { show: boolean; label?: string; url?: string };
}

/**
 * Only stacks that need no network request — the widget sits on someone
 * else's page and shouldn't pull a font file to render a chat bubble. "inter"
 * reuses the variable the host document already defines.
 */
const FONT_STACKS: Record<string, string> = {
  system:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  inter: 'var(--font-sans), ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

interface Palette {
  panel: string;
  msgArea: string;
  botBubble: string;
  botText: string;
  botBorder: string;
  inputBg: string;
  inputText: string;
  inputBorder: string;
  chipBg: string;
  chipText: string;
  chipBorder: string;
  subtle: string;
}

// Written as explicit palettes rather than Tailwind `dark:` variants: the
// embed page renders inside the CRM's root layout, which carries the `dark`
// class permanently, so every dark: variant would be on regardless of what
// the client configured.
const LIGHT: Palette = {
  panel: "#ffffff",
  msgArea: "#f8fafc",
  botBubble: "#ffffff",
  botText: "#1e293b",
  botBorder: "#e2e8f0",
  inputBg: "#ffffff",
  inputText: "#0f172a",
  inputBorder: "#e2e8f0",
  chipBg: "#ffffff",
  chipText: "#334155",
  chipBorder: "#cbd5e1",
  subtle: "#f1f5f9",
};

const DARK: Palette = {
  panel: "#0f172a",
  msgArea: "#020617",
  botBubble: "#1e293b",
  botText: "#e2e8f0",
  botBorder: "#334155",
  inputBg: "#0f172a",
  inputText: "#f1f5f9",
  inputBorder: "#334155",
  chipBg: "#1e293b",
  chipText: "#cbd5e1",
  chipBorder: "#475569",
  subtle: "#1e293b",
};

/**
 * Whether this visitor may be shown the teaser again.
 *
 * A proactive prompt that reappears on every page of a site is an irritation,
 * not an invitation, so the last time it was shown is recorded and honoured.
 * A cooldown of 0 means show it once and never again. Storage failures (private
 * browsing, blocked cookies) fall through to allowing it — showing a teaser one
 * extra time is a far smaller cost than never showing it at all.
 */
function teaserAllowed(siteId: string, cooldownHours: number): boolean {
  try {
    const raw = localStorage.getItem(`doai-teaser-${siteId}`);
    if (!raw) return true;
    if (cooldownHours <= 0) return false;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > cooldownHours * 3_600_000;
  } catch {
    return true;
  }
}

function markTeaserShown(siteId: string) {
  try {
    localStorage.setItem(`doai-teaser-${siteId}`, String(Date.now()));
  } catch {
    /* storage unavailable — the teaser simply isn't rate limited */
  }
}

interface Message {
  id: string;
  /** "agent" is a human operator replying from the CRM. */
  role: "user" | "assistant" | "agent";
  content: string;
}

/**
 * Who is answering. Only an operator taking over from the CRM moves this off
 * "bot" — visitors cannot request a person, so there is no pending state.
 */
type HandoffState = "bot" | "human";

/**
 * Narrows whatever the API returned. The column is an unconstrained string, so
 * a cast here would assert rather than convert — the mistake that let an
 * unexpected role reach the model and fail every request after a handback.
 *
 * "requested" is the retired visitor-initiated state. No rows carry it, but a
 * stale one should read as "a person has this", never silently as "bot".
 */
function toHandoffState(value: unknown): HandoffState {
  return value === "human" || value === "requested" ? "human" : "bot";
}

function getSessionId(siteId: string): string {
  const key = `doai-chat-session-${siteId}`;
  let sid = localStorage.getItem(key);
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem(key, sid);
  }
  return sid;
}

/** How the parent is currently presenting the iframe. */
type WidgetMode = "bubble" | "panel" | "fullscreen";

/**
 * Report open/closed to the parent and let it decide the geometry — only it
 * can see the host page's viewport, which is what determines whether an open
 * chat should be a panel or take the whole screen.
 *
 * width/height are still sent so an older cached widget.js, which sizes the
 * iframe from them directly and ignores `open`, keeps working.
 */
type WidgetState = "bubble" | "teaser" | "open";

const STATE_SIZE: Record<WidgetState, { width: number; height: number }> = {
  bubble: { width: 72, height: 72 },
  // Room for the teaser card stacked above the launcher. The iframe is
  // transparent here, so this rectangle does swallow clicks on whatever sits
  // beneath it — kept as tight as the content allows for that reason.
  teaser: { width: 320, height: 150 },
  open: { width: 380, height: 600 },
};

const LAUNCHER_CIRCLE = 72;
const LAUNCHER_PILL_HEIGHT = 56;

/**
 * A labelled launcher is a pill rather than a circle, so the collapsed iframe
 * has to be sized to match.
 *
 * Estimated rather than measured: the parent must size the iframe before the
 * button can render into it, so measuring would need a two-pass layout and a
 * visible reflow. Being a little generous is harmless — the pill simply sits
 * roomier than it strictly needs to.
 */
function launcherSize(label?: string | null) {
  const text = label?.trim();
  if (!text) return { width: LAUNCHER_CIRCLE, height: LAUNCHER_CIRCLE };
  return {
    width: Math.min(260, 64 + text.length * 8),
    height: LAUNCHER_PILL_HEIGHT,
  };
}

interface Placement {
  position: "left" | "right";
  offset: number;
  bubbleWidth: number;
  bubbleHeight: number;
  /** Names the iframe for screen readers — "Chat" alone says very little. */
  title?: string;
}

function postResizeToParent(state: WidgetState, p: Placement) {
  if (window.parent !== window) {
    const size =
      state === "bubble"
        ? { width: p.bubbleWidth, height: p.bubbleHeight }
        : STATE_SIZE[state];
    window.parent.postMessage(
      {
        type: "doai:resize",
        state,
        open: state === "open",
        position: p.position,
        offset: p.offset,
        title: p.title,
        ...size,
      },
      "*"
    );
  }
}

function EmbedContent() {
  const searchParams = useSearchParams();
  const siteId = searchParams.get("siteId") || "";

  const [config, setConfig] = useState<Config | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [mode, setMode] = useState<WidgetMode>("bubble");
  const [showTeaser, setShowTeaser] = useState(false);
  const [hasPriorHistory, setHasPriorHistory] = useState(false);
  const [handoff, setHandoff] = useState<HandoffState>("bot");
  // Screen readers get the finished reply once, rather than every token of a
  // streaming one — a live region attached to the streaming bubble itself
  // re-announces on each chunk and is unusable.
  const [announcement, setAnnouncement] = useState("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasSending = useRef(false);
  const wasOpen = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load config + restore any prior transcript.
  //
  // The iframe is torn down on every page navigation, so without this the
  // visitor saw an empty panel and a fresh greeting while the server carried
  // on appending to the same conversation — the bot would then refer back to
  // things they could no longer see. The sessionId in localStorage is what
  // ties the two together.
  useEffect(() => {
    if (!siteId) return;
    const sid = getSessionId(siteId);
    setSessionId(sid);

    const configReq = fetch(
      `/api/website-chat/config?siteId=${encodeURIComponent(siteId)}`
    ).then((r) => r.json());

    // History is best-effort: a failure here should degrade to a fresh-looking
    // conversation, never block the widget from loading.
    const historyReq = fetch(
      `/api/website-chat/history?siteId=${encodeURIComponent(
        siteId
      )}&sessionId=${encodeURIComponent(sid)}`
    )
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .catch(() => ({ messages: [] }));

    Promise.all([configReq, historyReq])
      .then(([cfg, hist]) => {
        if (cfg.error) {
          console.error("[Widget] Config error:", cfg.error);
          return;
        }
        setConfig(cfg);

        const restored: Message[] = (hist?.messages ?? []).map(
          (m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role:
              m.role === "user"
                ? "user"
                : m.role === "agent"
                ? "agent"
                : "assistant",
            content: m.content,
          })
        );
        if (hist?.handoffState) setHandoff(toHandoffState(hist.handoffState));

        // Keep the greeting as the opener so a returning visitor sees the
        // same conversation they left, rather than one that starts mid-air.
        const opener: Message[] = cfg.greeting
          ? [{ id: "greeting", role: "assistant", content: cfg.greeting }]
          : [];

        setMessages([...opener, ...restored]);
        setHasPriorHistory(restored.some((m) => m.role === "user"));
      })
      .catch((err) => console.error("[Widget] Failed to load config:", err));
  }, [siteId]);

  // Notify parent of the presentation state and placement. Placement is
  // config-driven, so it can only be sent once the config has loaded — the
  // parent holds sensible defaults until then.
  useEffect(() => {
    const size = launcherSize(config?.launcherLabel);
    postResizeToParent(isOpen ? "open" : showTeaser ? "teaser" : "bubble", {
      position: config?.launcherPosition === "left" ? "left" : "right",
      offset:
        typeof config?.launcherOffset === "number" && config.launcherOffset >= 0
          ? config.launcherOffset
          : 20,
      bubbleWidth: size.width,
      bubbleHeight: size.height,
      title: config?.botName ? `Chat with ${config.botName}` : undefined,
    });
  }, [isOpen, showTeaser, config]);

  // "auto" follows the visitor's OS setting, which the iframe can read
  // directly — it is a real document, not a shadow root.
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Proactive teaser.
  //
  // Deliberately suppressed for anyone who has already talked to us: a visitor
  // returning mid-conversation being asked "can I help?" reads as the bot
  // having forgotten them. Opening the chat cancels it for the same reason.
  useEffect(() => {
    if (!config?.proactiveEnabled) return;
    const message = config.proactiveMessage?.trim();
    if (!message) return;
    if (isOpen || hasPriorHistory) return;
    if (!teaserAllowed(siteId, config.proactiveCooldownHours)) return;

    const delayMs = Math.max(0, config.proactiveDelaySeconds) * 1000;
    const timer = setTimeout(() => {
      setShowTeaser(true);
      // Recorded on show, not on dismiss — a visitor who ignores it has still
      // been asked, and shouldn't be asked again on the next page.
      markTeaserShown(siteId);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [config, isOpen, hasPriorHistory, siteId]);

  // The parent reports back which shape it settled on. Only used for styling
  // — the host page already controls the iframe's size outright, so a hostile
  // host forcing a mode gains nothing it couldn't already do.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent) return;
      const data = e.data as { type?: string; mode?: string } | null;
      if (data?.type !== "doai:mode") return;
      if (
        data.mode === "bubble" ||
        data.mode === "panel" ||
        data.mode === "fullscreen"
      ) {
        setMode(data.mode);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The embed page renders inside the CRM's root layout, which paints a dark
  // body. That never showed while the bubble and panel covered the iframe
  // edge to edge, but the teaser leaves transparent gaps — without this it
  // would sit on a black rectangle over the client's page.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /**
   * While open, poll for messages an operator may have sent from the CRM.
   *
   * The widget has no push channel, so without this a human reply would sit
   * unseen until the visitor reloaded the page. Suspended entirely while a
   * reply is streaming — a poll landing mid-stream would replace the partial
   * bubble with the server's view and the text would visibly jump — and while
   * the tab is hidden, since nobody is reading it.
   */
  useEffect(() => {
    if (!isOpen || sending || !siteId || !sessionId) return;

    let cancelled = false;

    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(
          `/api/website-chat/history?siteId=${encodeURIComponent(
            siteId
          )}&sessionId=${encodeURIComponent(sessionId)}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.handoffState) setHandoff(toHandoffState(data.handoffState));

        const restored: Message[] = (data.messages ?? []).map(
          (m: { id: string; role: string; content: string }) => ({
            id: m.id,
            role:
              m.role === "user"
                ? "user"
                : m.role === "agent"
                ? "agent"
                : "assistant",
            content: m.content,
          })
        );
        const opener: Message[] = config?.greeting
          ? [{ id: "greeting", role: "assistant", content: config.greeting }]
          : [];
        // Adopt the server's view outright. Polling is suspended while a
        // reply is streaming, so there is never a partial bubble to clobber —
        // and the previous length comparison silently stopped updating as soon
        // as anything local was longer than the server's copy.
        setMessages([...opener, ...restored]);
      } catch {
        /* transient network failure — the next tick tries again */
      }
    };

    const timer = setInterval(poll, 6000);

    // Ticks are skipped while the tab is hidden, so catch up the moment it
    // comes back rather than leaving the visitor looking at a stale transcript
    // for up to a full interval after they return.
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isOpen, sending, siteId, sessionId, config]);

  /**
   * Hand the visitor over to the client's own booking or contact form.
   *
   * This replaced a "Talk to a person" button, which promised something the
   * product does not provide: nobody watches the chats, so asking for a human
   * got silence. A form the client already staffs is a promise the site keeps.
   *
   * The panel closes first. On mobile it covers the screen, and scrolling the
   * page behind it would move the visitor somewhere they cannot see.
   */
  const openCTA = useCallback(() => {
    if (!config || window.parent === window) return;
    setIsOpen(false);
    window.parent.postMessage(
      {
        type: "doai:cta",
        selector: config.ctaSelector,
        url: config.ctaUrl,
      },
      "*"
    );
  }, [config]);

  // Move focus into the panel on open and hand it back to the launcher on
  // close. Without this a keyboard user opens the chat and their focus is
  // still on a button that no longer exists.
  useEffect(() => {
    // Focused directly rather than inside requestAnimationFrame: effects run
    // after the DOM is committed, so the target already exists, and rAF is
    // throttled in a hidden tab — which would silently skip focus entirely.
    if (isOpen && !wasOpen.current) {
      inputRef.current?.focus();
    } else if (!isOpen && wasOpen.current) {
      launcherRef.current?.focus();
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  // Announce a reply once it has finished streaming.
  useEffect(() => {
    if (wasSending.current && !sending) {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant" && last.content) {
        setAnnouncement(last.content);
      }
    }
    wasSending.current = sending;
  }, [sending, messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || sending || !config) return;
      setSending(true);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      // No pending-reply bubble while a human has the conversation. An empty
      // bubble renders as the typing indicator, and during handoff nothing is
      // ever going to fill it — the dots would sit there permanently, telling
      // the visitor someone is typing when nobody is.
      const expectBotReply = handoff === "bot";
      const assistantId = crypto.randomUUID();
      if (expectBotReply) {
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "" },
        ]);
      }

      try {
        const res = await fetch("/api/website-chat/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            sessionId,
            message: text,
            userAgent: navigator.userAgent,
            referrer: document.referrer,
          }),
        });

        if (!res.ok || !res.body) {
          const errMsg = await res.text();
          console.error("[Widget] API error:", errMsg);
          setMessages((prev) =>
            expectBotReply
              ? prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content:
                          "Sorry, something went wrong. Please try again.",
                      }
                    : m
                )
              : prev
          );
          return;
        }

        // A JSON body rather than an event stream means the server declined to
        // generate — currently because the conversation is with a human. Adopt
        // the state it reports and drop any placeholder, rather than feeding
        // JSON through the SSE parser and leaving an empty bubble behind.
        if (!res.headers.get("content-type")?.includes("text/event-stream")) {
          const data = await res.json().catch(() => null);
          if (data?.handoffState) setHandoff(toHandoffState(data.handoffState));
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                fullContent += parsed.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: fullContent } : m
                  )
                );
              }
            } catch {
              // ignore parse errors for stray chunks
            }
          }
        }
      } catch (err) {
        console.error("[Widget] Send error:", err);
        setMessages((prev) =>
          expectBotReply
            ? prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: "Connection error. Please try again." }
                  : m
              )
            : prev
        );
      } finally {
        setSending(false);
      }
    },
    // `handoff` matters: without it the callback keeps a stale value and would
    // still draw a pending-reply bubble after the conversation moved to a human.
    [config, sending, siteId, sessionId, handoff]
  );

  if (!siteId) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm p-4">
        Missing siteId
      </div>
    );
  }

  if (!config) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const brandColor = config.brandColor || "#2563eb";
  // Text sitting on brandColor was hardcoded white, so a pale brand colour
  // rendered an unreadable widget on the client's own site. Pick the readable
  // foreground instead of assuming one.
  const onBrand = readableTextOn(brandColor);
  const isDark =
    config.theme === "dark" || (config.theme === "auto" && prefersDark);
  const pal = isDark ? DARK : LIGHT;
  const fontFamily = FONT_STACKS[config.fontFamily] ?? FONT_STACKS.system;
  const launcherText = config.launcherLabel?.trim() || "";

  if (!isOpen) {
    const size = launcherSize(config.launcherLabel);
    const launcher = (
      <button
        ref={launcherRef}
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={false}
        className={`rounded-full flex items-center justify-center gap-2 px-4 shadow-lg hover:scale-105 motion-reduce:hover:scale-100 motion-reduce:transition-none transition-transform ${
          showTeaser ? "shrink-0" : "w-full h-full"
        }`}
        style={{
          backgroundColor: brandColor,
          color: onBrand.color,
          fontFamily,
          // In teaser mode the launcher is one item in a taller iframe, so it
          // needs explicit dimensions; on its own it just fills the iframe the
          // parent already sized for it.
          ...(showTeaser ? { width: size.width, height: size.height } : {}),
        }}
        aria-label={launcherText || "Open chat"}
      >
        {config.launcherIcon ? (
          <span className="text-xl leading-none shrink-0">
            {config.launcherIcon}
          </span>
        ) : (
          <MessageCircle className="w-6 h-6 shrink-0" />
        )}
        {launcherText && (
          <span className="text-sm font-medium whitespace-nowrap">
            {launcherText}
          </span>
        )}
      </button>
    );

    if (!showTeaser) return launcher;

    return (
      <div
        className={`w-full h-full flex flex-col justify-end gap-2 ${
          config.launcherPosition === "left" ? "items-start" : "items-end"
        }`}
      >
        <div className="relative">
          <button
            onClick={() => {
              setShowTeaser(false);
              setIsOpen(true);
            }}
            className={`max-w-[260px] text-left text-sm rounded-2xl border shadow-lg px-3.5 py-2.5 transition-opacity hover:opacity-90 ${
              config.launcherPosition === "left"
                ? "rounded-bl-md"
                : "rounded-br-md"
            }`}
            style={{
              backgroundColor: pal.botBubble,
              color: pal.botText,
              borderColor: pal.botBorder,
              fontFamily,
            }}
          >
            {config.proactiveMessage}
          </button>
          {/*
            Dismiss sits at the card's top-left, not top-right: the card is
            right-aligned to the iframe edge, so a right-hand badge would be
            clipped by the iframe boundary.
          */}
          <button
            onClick={() => setShowTeaser(false)}
            aria-label="Dismiss message"
            className={`absolute -top-2 w-6 h-6 rounded-full bg-slate-600 text-white flex items-center justify-center shadow hover:bg-slate-700 transition-colors ${
              config.launcherPosition === "left" ? "-right-2" : "-left-2"
            }`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {launcher}
      </div>
    );
  }

  return (
    // Full-screen fills a square iframe, so its own rounding would show
    // transparent notches at the corners.
    <div
      ref={panelRef}
      role="dialog"
      // Only the full-screen presentation is genuinely modal. The desktop
      // panel sits in the corner and leaves the page usable behind it, so
      // claiming aria-modal there would wrongly tell a screen reader the rest
      // of the page had gone away.
      aria-modal={mode === "fullscreen" ? true : undefined}
      aria-label={`Chat with ${config.botName}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setIsOpen(false);
          return;
        }
        // Trap Tab only while modal. Trapping in the corner panel would strand
        // a keyboard user inside a widget they never asked to be captured by.
        if (e.key !== "Tab" || mode !== "fullscreen") return;
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      className={`w-full h-full flex flex-col overflow-hidden ${
        mode === "fullscreen" ? "" : "rounded-2xl shadow-2xl"
      }`}
      /*
        The scrollbar colours are set here rather than inherited.
        globals.css defines them per palette, but this page renders inside the
        CRM's root layout, which carries `dark` permanently — the same reason
        the palettes above are explicit instead of Tailwind `dark:` variants.
        Inheriting would give a client who chose a light widget a scrollbar
        styled for a near-black panel.
      */
      style={
        {
          backgroundColor: pal.panel,
          fontFamily,
          "--scrollbar-thumb": pal.chipBorder,
          "--scrollbar-thumb-hover": pal.chipText,
        } as React.CSSProperties
      }
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{
          backgroundColor: brandColor,
          color: onBrand.color,
          // Let the header colour run up under a notch or status bar rather
          // than leaving a white strip above it.
          paddingTop:
            mode === "fullscreen"
              ? "max(0.75rem, env(safe-area-inset-top))"
              : undefined,
        }}
      >
        <div>
          <p className="font-semibold text-sm">{config.botName}</p>
          <p className="text-[11px] opacity-80">{config.name}</p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          // 28px is under the 44px minimum touch target, which matters far
          // more on a phone than in a desktop corner panel.
          className={`rounded-full flex items-center justify-center transition-colors ${
            mode === "fullscreen" ? "w-11 h-11 -mr-2" : "w-7 h-7"
          }`}
          // A white hover veil is invisible on a pale header already carrying
          // dark text, so the overlay follows the text colour.
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = onBrand.hoverOverlay;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div
        role="log"
        aria-label="Conversation"
        className="flex-1 overflow-y-auto p-3 space-y-2.5"
        style={{ backgroundColor: pal.msgArea }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            {/*
              A visitor who asked for a person needs to see, unambiguously,
              that one has arrived — otherwise the handoff is invisible and
              they assume they are still talking to the bot.
            */}
            {msg.role === "agent" && (
              <span
                className="text-[10px] font-medium mb-0.5 px-1"
                style={{ color: pal.chipText }}
              >
                {config.name} team
              </span>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                msg.role === "user" ? "rounded-br-md" : "border rounded-bl-md"
              }`}
              style={
                msg.role === "user"
                  ? { backgroundColor: brandColor, color: onBrand.color }
                  : {
                      backgroundColor: pal.botBubble,
                      color: pal.botText,
                      // Human replies carry the brand colour on their border,
                      // so they read as distinct from the bot at a glance
                      // without needing a different bubble colour.
                      borderColor:
                        msg.role === "agent" ? brandColor : pal.botBorder,
                    }
              }
            >
              {msg.content || (
                <span className="inline-flex gap-1" aria-label="Typing">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce motion-reduce:animate-none" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce motion-reduce:animate-none [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce motion-reduce:animate-none [animation-delay:300ms]" />
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/*
        Off-screen announcer. Kept separate from the message list so a screen
        reader hears each reply once, complete — attaching a live region to the
        streaming bubble re-announces it on every token.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only absolute w-px h-px overflow-hidden whitespace-nowrap"
        style={{ clip: "rect(0 0 0 0)" }}
      >
        {announcement}
      </div>

      {/* Quick replies (only show before any user message) */}
      {config.quickReplies &&
        config.quickReplies.length > 0 &&
        !messages.some((m) => m.role === "user") && (
          <div
            className="px-3 pb-2 flex flex-wrap gap-1.5"
            style={{ backgroundColor: pal.msgArea }}
          >
            {config.quickReplies.map((reply, i) => (
              <button
                key={i}
                onClick={() => sendMessage(reply)}
                disabled={sending}
                className="text-xs px-2.5 py-1.5 rounded-full border hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{
                  backgroundColor: pal.chipBg,
                  color: pal.chipText,
                  borderColor: pal.chipBorder,
                }}
              >
                {reply}
              </button>
            ))}
          </div>
        )}

      {/*
        Route to the client's own booking or contact form.

        Only offered once the visitor has said something — a call to action
        before they have asked anything is a popup, not an offer — and only
        when the client has configured somewhere for it to go. A button that
        leads nowhere is worse than no button.

        The status line below it is for the other direction: an operator who
        takes the conversation over from the CRM. That still happens, it is
        just never something the visitor can request.
      */}
      {handoff === "bot" ? (
        config.ctaLabel &&
        (config.ctaSelector || config.ctaUrl) &&
        messages.some((m) => m.role === "user") && (
          <button
            onClick={openCTA}
            className="px-3 pb-1.5 text-[11px] text-left underline underline-offset-2 hover:opacity-80 transition-opacity"
            style={{ color: pal.chipText, backgroundColor: pal.msgArea }}
          >
            {config.ctaLabel}
          </button>
        )
      ) : (
        <div
          role="status"
          className="px-3 py-1.5 text-[11px]"
          style={{ backgroundColor: pal.msgArea, color: pal.chipText }}
        >
          You&apos;re now talking to the team.
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="p-3 border-t flex gap-2"
        style={{
          backgroundColor: pal.panel,
          borderColor: pal.inputBorder,
          // Keep the input clear of the home indicator.
          ...(mode === "fullscreen"
            ? { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }
            : {}),
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          // Submit on Enter explicitly rather than relying on the form's
          // implicit submission, which was not firing in practice — people
          // expect Enter to send in a chat box, and having to reach for the
          // button is the kind of friction that loses a conversation.
          //
          // isComposing guards IME input (Japanese, Chinese, Korean): Enter
          // there confirms a candidate word and must not send the message.
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (sending || !input.trim()) return; // mirror the Send button
            sendMessage(input);
          }}
          ref={inputRef}
          placeholder="Type a message..."
          // A placeholder is not an accessible name — it disappears the moment
          // anything is typed and some screen readers never announce it.
          aria-label="Type a message"
          disabled={sending}
          className="flex-1 px-3 py-2 text-sm border rounded-lg outline-none disabled:opacity-50"
          style={{
            backgroundColor: pal.subtle,
            color: pal.inputText,
            borderColor: pal.inputBorder,
          }}
          // The focus ring is drawn in the brand colour rather than left to a
          // Tailwind default, so it stays visible on both light and dark
          // panels whatever the client picked.
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = `0 0 0 2px ${brandColor}`;
            e.currentTarget.style.borderColor = brandColor;
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "";
            e.currentTarget.style.borderColor = pal.inputBorder;
          }}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-50"
          style={{ backgroundColor: brandColor, color: onBrand.color }}
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/*
        Attribution. Whether it appears is decided server-side from the plan,
        and because the widget lives in an iframe a client cannot CSS-hide it
        from their own page — so removing it really is a paid feature rather
        than an honour system.
      */}
      {config.branding?.show && (
        <div
          className="px-3 pb-2 text-center"
          style={{ backgroundColor: pal.panel }}
        >
          {config.branding.url ? (
            <a
              href={config.branding.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] opacity-60 hover:opacity-100 transition-opacity"
              style={{ color: pal.chipText }}
            >
              Powered by {config.branding.label}
            </a>
          ) : (
            <span
              className="text-[10px] opacity-60"
              style={{ color: pal.chipText }}
            >
              Powered by {config.branding.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={null}>
      <EmbedContent />
    </Suspense>
  );
}
