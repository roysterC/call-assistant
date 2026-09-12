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
  proactiveEnabled: boolean;
  proactiveMessage: string | null;
  proactiveDelaySeconds: number;
  proactiveCooldownHours: number;
}

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
  role: "user" | "assistant";
  content: string;
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

function postResizeToParent(state: WidgetState) {
  if (window.parent !== window) {
    const size = STATE_SIZE[state];
    window.parent.postMessage(
      { type: "doai:resize", state, open: state === "open", ...size },
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
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })
        );

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

  // Notify parent of the presentation state
  useEffect(() => {
    postResizeToParent(isOpen ? "open" : showTeaser ? "teaser" : "bubble");
  }, [isOpen, showTeaser]);

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

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

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
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: "Sorry, something went wrong. Please try again.",
                  }
                : m
            )
          );
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
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Connection error. Please try again." }
              : m
          )
        );
      } finally {
        setSending(false);
      }
    },
    [config, sending, siteId, sessionId]
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

  if (!isOpen) {
    const launcher = (
      <button
        onClick={() => setIsOpen(true)}
        className={`rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform ${
          showTeaser ? "w-[72px] h-[72px] shrink-0" : "w-full h-full"
        }`}
        style={{ backgroundColor: brandColor, color: onBrand.color }}
        aria-label="Open chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );

    if (!showTeaser) return launcher;

    return (
      <div className="w-full h-full flex flex-col items-end justify-end gap-2">
        <div className="relative">
          <button
            onClick={() => {
              setShowTeaser(false);
              setIsOpen(true);
            }}
            className="max-w-[260px] text-left bg-white text-slate-800 text-sm rounded-2xl rounded-br-md border border-slate-200 shadow-lg px-3.5 py-2.5 hover:bg-slate-50 transition-colors"
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
            className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-slate-600 text-white flex items-center justify-center shadow hover:bg-slate-700 transition-colors"
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
      className={`w-full h-full flex flex-col bg-white overflow-hidden ${
        mode === "fullscreen" ? "" : "rounded-2xl shadow-2xl"
      }`}
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
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                msg.role === "user"
                  ? "rounded-br-md"
                  : "bg-white text-slate-800 border border-slate-200 rounded-bl-md"
              }`}
              style={
                msg.role === "user"
                  ? { backgroundColor: brandColor, color: onBrand.color }
                  : {}
              }
            >
              {msg.content || (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick replies (only show before any user message) */}
      {config.quickReplies &&
        config.quickReplies.length > 0 &&
        !messages.some((m) => m.role === "user") && (
          <div className="px-3 pb-2 flex flex-wrap gap-1.5 bg-slate-50">
            {config.quickReplies.map((reply, i) => (
              <button
                key={i}
                onClick={() => sendMessage(reply)}
                disabled={sending}
                className="text-xs px-2.5 py-1.5 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {reply}
              </button>
            ))}
          </div>
        )}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="p-3 border-t border-slate-200 flex gap-2 bg-white"
        style={
          mode === "fullscreen"
            ? {
                // Keep the input clear of the home indicator.
                paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
              }
            : undefined
        }
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
          placeholder="Type a message..."
          disabled={sending}
          className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
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
