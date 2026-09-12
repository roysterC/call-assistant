"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, X, Send } from "lucide-react";

interface Config {
  siteId: string;
  name: string;
  botName: string;
  greeting: string | null;
  quickReplies: string[];
  brandColor: string;
  enabled: boolean;
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

function postResizeToParent(width: number, height: number) {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "doai:resize", width, height }, "*");
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
      })
      .catch((err) => console.error("[Widget] Failed to load config:", err));
  }, [siteId]);

  // Notify parent of size changes
  useEffect(() => {
    if (isOpen) {
      postResizeToParent(380, 600);
    } else {
      postResizeToParent(72, 72);
    }
  }, [isOpen]);

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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full h-full rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 transition-transform"
        style={{ backgroundColor: brandColor }}
        aria-label="Open chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between text-white"
        style={{ backgroundColor: brandColor }}
      >
        <div>
          <p className="font-semibold text-sm">{config.botName}</p>
          <p className="text-[11px] opacity-80">{config.name}</p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center"
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
                  ? "text-white rounded-br-md"
                  : "bg-white text-slate-800 border border-slate-200 rounded-bl-md"
              }`}
              style={
                msg.role === "user" ? { backgroundColor: brandColor } : {}
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
          className="w-9 h-9 rounded-lg text-white flex items-center justify-center disabled:opacity-50"
          style={{ backgroundColor: brandColor }}
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
