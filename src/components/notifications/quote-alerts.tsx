"use client";

/**
 * "Quote needed" in the corner: a client is waiting for a price on designs
 * they sent (src/lib/quotes.ts). Checked every half minute and when the
 * window comes back into view; shown until it is opened, closed for now, or
 * answered by anyone at the salon.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import type { OpenQuote } from "@/components/conversations/quote-panel";

/** Asks an open Conversations page to show a chat's quote: `detail` is { c, ch }. */
export const OPEN_QUOTE = "kikai:open-quote";

/** Tells the alert a quote is open on screen already, so it need not be shown: `detail` is the quote's id. */
const QUOTE_SEEN = "kikai:quote-seen";

const POLL_MS = 30_000;
const CLOSED_KEY = "kikai:closed-quotes";
const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };

function closedIds(): string[] {
  try {
    const raw = sessionStorage.getItem(CLOSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function rememberClosed(ids: string[]) {
  try {
    sessionStorage.setItem(CLOSED_KEY, JSON.stringify(ids));
  } catch {
    // Closed for this page only.
  }
}

/** The quote is open in the inbox: no need to point at it from the corner. */
export function quoteSeen(id: string) {
  const ids = closedIds();
  if (!ids.includes(id)) rememberClosed([...ids, id]);
  window.dispatchEvent(new CustomEvent(QUOTE_SEEN, { detail: id }));
}

/** Open a chat's quote: in place on Conversations, otherwise by going there. */
export function openQuote(channel: string, conversationId: string, pathname: string | null, push: (url: string) => void) {
  if (pathname?.startsWith("/conversations")) {
    window.dispatchEvent(new CustomEvent(OPEN_QUOTE, { detail: { c: conversationId, ch: channel } }));
  } else {
    push(withAsOrg(`/conversations?c=${encodeURIComponent(conversationId)}&ch=${encodeURIComponent(channel)}&quote=1`));
  }
}

export function QuoteAlerts() {
  const [quotes, setQuotes] = useState<OpenQuote[]>([]);
  // Closed for this browser tab: read once, as the alert first renders.
  const [closed, setClosed] = useState<string[]>(() => (typeof window === "undefined" ? [] : closedIds()));
  const router = useRouter();
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/quotes");
      if (!res.ok) return;
      const data = await res.json();
      setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
    } catch {
      // Checked again shortly.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetched from the server; its answer sets the state
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  useEffect(() => {
    const seen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setClosed((all) => (all.includes(id) ? all : [...all, id]));
    };
    window.addEventListener(QUOTE_SEEN, seen);
    return () => window.removeEventListener(QUOTE_SEEN, seen);
  }, []);

  const close = (id: string) => {
    const next = closed.includes(id) ? closed : [...closed, id];
    setClosed(next);
    rememberClosed(next);
  };

  const showing = quotes.filter((q) => !closed.includes(q.id));
  if (showing.length === 0) return null;
  const q = showing[0];
  const n = q.items.length;

  return (
    <section
      aria-label="Quotes waiting"
      aria-live="polite"
      className="fixed inset-x-2 top-16 z-50 md:inset-x-auto md:right-4 md:top-4 md:w-[360px]"
    >
      <article className="flex items-center gap-3 rounded-2xl bg-[#2a2e22] p-3.5 text-white shadow-raised animate-in fade-in-0 slide-in-from-top-2">
        <div className="flex shrink-0">
          {q.items.slice(0, 3).map((it) => (
            // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image
            <img
              key={it.photoId}
              src={withAsOrg(`/api/chat-photos/${it.photoId}`)}
              alt=""
              className="-mr-2.5 h-11 w-9 rounded-[9px] border-2 border-[#2a2e22] bg-white/20 object-cover"
            />
          ))}
        </div>
        <div className="min-w-0 flex-1 pl-2.5">
          <p className="text-sm font-bold">Quote needed{showing.length > 1 ? ` · ${showing.length} waiting` : ""}</p>
          <p className="truncate text-[12.5px] opacity-80">
            {q.clientName ?? "A client"} sent {n === 1 ? "a design" : `${n} designs`} on {CHANNEL_LABEL[q.channel] ?? q.channel}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 bg-tea-green-800 text-[#2a2e22] hover:bg-tea-green-700"
          onClick={() => {
            close(q.id);
            openQuote(q.channel, q.conversationId, pathname, router.push);
          }}
        >
          Quote now
        </Button>
        <button
          type="button"
          onClick={() => close(q.id)}
          aria-label={`Close the quote alert for ${q.clientName ?? "this client"}`}
          className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg opacity-70 hover:bg-white/10 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </article>
    </section>
  );
}
