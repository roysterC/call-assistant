"use client";

/**
 * Pricing a client's designs (src/lib/quotes.ts): beside the chat on a
 * computer, over it on a phone, one design at a time.
 *
 * Each design is a picture they sent. Tap it, enter a price and, if it is
 * not the service's usual length, a time; or mark it as not something the
 * salon does. What the client will read is shown underneath as it is typed,
 * word for word (quote-text.ts), and goes back in their chat on Send.
 */

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { minutesText, quoteReady, quoteReply, type QuoteItem } from "@/lib/quote-text";
import { useMe } from "@/components/providers/me-provider";
import { useT } from "@/components/providers/language-provider";
import { PhotoViewer } from "@/components/ui/photo-viewer";

export interface OpenQuote {
  id: string;
  channel: string;
  conversationId: string;
  clientName: string | null;
  request: string;
  items: QuoteItem[];
  status: string;
  createdAt: string;
  sentAt: string | null;
  sentBy: string | null;
  sentVia: string | null;
}

/** Lengths offered as chips; "" is the service's usual length. */
const TIMES = ["", "60", "90", "120", "150", "180"];

interface Draft {
  price: string;
  minutes: string;
  declined: boolean;
}

export function QuotePanel({
  quote,
  onClose,
  onSent,
}: {
  quote: OpenQuote;
  onClose: () => void;
  onSent: (via: "chat" | "sms") => void;
}) {
  const me = useMe();
  const { t } = useT();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    quote.items.map(() => ({ price: "", minutes: "", declined: false }))
  );
  const [sel, setSel] = useState(0);
  // The design open full size, over the panel.
  const [photoAt, setPhotoAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items: QuoteItem[] = useMemo(
    () =>
      quote.items.map((item, i) => ({
        photoId: item.photoId,
        priceMinor: drafts[i].declined ? null : parseMoney(drafts[i].price),
        minutes: drafts[i].declined || !drafts[i].minutes ? null : Number(drafts[i].minutes),
        declined: drafts[i].declined,
      })),
    [quote.items, drafts]
  );
  const ready = quoteReady(items);
  const done = items.filter((i) => i.declined || i.priceMinor !== null).length;
  const from = me?.name?.trim().split(/\s+/)[0] ?? null;
  const preview = done > 0 ? quoteReply(items, from) : null;
  const name = quote.clientName ?? t("qp.them");
  const many = quote.items.length > 1;
  const cur = drafts[sel];
  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const nextOpen = items.findIndex((it, i) => i !== sel && !it.declined && it.priceMinor === null);

  const send = async () => {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/quotes/${quote.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("qp.sendFailed"));
        return;
      }
      onSent(data.via === "sms" ? "sms" : "chat");
    } catch {
      setError(t("common.offline"));
    } finally {
      setSending(false);
    }
  };

  const tile = (i: number, size: "md" | "sm") => {
    const it = items[i];
    const label = it.declined
      ? t("qp.notOffered")
      : it.priceMinor !== null
        ? `£${(it.priceMinor / 100).toFixed(it.priceMinor % 100 ? 2 : 0)}${it.minutes ? ` · ${minutesText(it.minutes)}` : ""}`
        : size === "sm"
          ? String(i + 1)
          : t("qp.tapToPrice");
    const priced = !it.declined && it.priceMinor !== null;
    return (
      <button
        key={it.photoId}
        type="button"
        onClick={() => setSel(i)}
        aria-pressed={sel === i}
        aria-label={t("qp.designLabel", { n: i + 1, label })}
        className={cn(
          "relative overflow-hidden rounded-[14px] bg-muted",
          size === "md" ? "h-28" : "h-[58px] flex-1",
          sel === i ? "ring-3 ring-primary" : "ring-1 ring-border"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image */}
        <img src={withAsOrg(`/api/chat-photos/${it.photoId}`)} alt="" className="h-full w-full object-cover" />
        {size === "md" && (
          <span className="absolute left-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white/90 text-xs font-bold text-[#2a2e22]">
            {i + 1}
          </span>
        )}
        <span
          className={cn(
            "absolute inset-x-1.5 bottom-1.5 flex items-center justify-center rounded-lg font-bold",
            size === "md" ? "h-[26px] text-[12.5px]" : "h-5 text-[11px]",
            priced ? "bg-primary text-primary-foreground" : "bg-white/90 text-[#2a2e22]"
          )}
        >
          {label}
        </span>
      </button>
    );
  };

  // A sheet from the bottom on a phone; a drawer over the chat on a tablet or
  // laptop, where beside the list and the thread it left the thread a sliver;
  // beside the thread only on the widest screens.
  return (
    <div
      role="dialog"
      aria-label={t("qp.quoteFor", { name })}
      className="fixed inset-0 z-50 flex flex-col bg-tea-green-100/45 md:flex-row md:justify-end 2xl:static 2xl:z-auto 2xl:w-[27.5rem] 2xl:shrink-0 2xl:border-l 2xl:border-border 2xl:bg-card"
    >
      <div className="mt-9 flex min-h-0 flex-1 flex-col rounded-t-3xl bg-card md:mt-0 md:w-[27.5rem] md:flex-none md:rounded-none md:border-l md:border-border md:shadow-raised 2xl:w-full 2xl:border-0 2xl:shadow-none">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-tea-green-700 md:hidden" aria-hidden="true" />
        <div className="flex items-start gap-2.5 px-4 pt-3 md:px-5 md:pt-[18px]">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.07em] text-tea-green-200">{t("qp.quoteFor", { name })}</p>
            <h2 className="font-heading text-xl font-extrabold">
              <span className="md:hidden">{many ? t("qp.designOf", { n: sel + 1, total: quote.items.length }) : t("qp.theirDesign")}</span>
              <span className="phone:hidden">
                {t("qp.priced", { done, total: quote.items.length })}
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tea-green-900 text-muted-foreground hover:bg-tea-green-800"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="mx-4 mt-3 rounded-xl bg-tea-green-900 px-3 py-2 text-[13px] leading-snug md:mx-5">
            <span className="font-semibold">{t("qp.theyAsked")}</span>
            {quote.request}
          </p>

          {many && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2.5 px-5 phone:hidden">{quote.items.map((_, i) => tile(i, "md"))}</div>
              <div className="mt-3 flex gap-2 px-4 md:hidden">{quote.items.map((_, i) => tile(i, "sm"))}</div>
            </>
          )}

          <div className="mx-4 mt-3 flex flex-col gap-3.5 rounded-2xl bg-tea-green-900 p-3.5 md:mx-5 md:flex-row">
            <button
              type="button"
              onClick={() => setPhotoAt(sel)}
              aria-label={t("qp.openDesign", { n: sel + 1 })}
              className="h-56 w-full shrink-0 overflow-hidden rounded-xl bg-muted transition-opacity hover:opacity-90 md:h-[150px] md:w-[120px]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image */}
              <img
                src={withAsOrg(`/api/chat-photos/${quote.items[sel].photoId}`)}
                alt={t("qp.design", { n: sel + 1 })}
                className="h-full w-full object-cover"
              />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <p className="text-sm font-bold phone:hidden">{t("qp.design", { n: sel + 1 })}</p>
              {cur.declined ? (
                <p className="text-[13px] text-muted-foreground">
                  {many ? t("qp.notOneYouDoMany", { name }) : t("qp.notOneYouDo", { name })}{" "}
                  <button
                    type="button"
                    onClick={() => update(sel, { declined: false })}
                    className="font-semibold text-primary"
                  >
                    {t("qp.priceAfterAll")}
                  </button>
                </p>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12.5px] font-semibold text-muted-foreground">{t("qp.price")}</span>
                    <span className="flex h-12 items-center gap-1 rounded-xl border-[1.5px] border-tea-green-500 bg-card px-3 focus-within:border-tea-green-300 focus-within:ring-3 focus-within:ring-tea-green-800 phone:h-14">
                      <span className="text-lg text-muted-foreground">£</span>
                      <input
                        inputMode="decimal"
                        value={cur.price}
                        onChange={(e) => update(sel, { price: e.target.value.replace(/[^0-9.]/g, "") })}
                        placeholder="0"
                        aria-label={t("qp.priceFor", { n: sel + 1 })}
                        className="min-w-0 flex-1 bg-transparent text-xl font-bold tabular-nums focus:outline-none phone:text-2xl"
                      />
                    </span>
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12.5px] font-semibold text-muted-foreground">
                      {t("qp.timeNeeded")} <span className="font-normal">{t("qp.optional")}</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {TIMES.map((m) => (
                        <button
                          key={m || "usual"}
                          type="button"
                          aria-pressed={cur.minutes === m}
                          onClick={() => update(sel, { minutes: m })}
                          className={cn(
                            "h-[30px] rounded-full border px-2.5 text-[12.5px] font-semibold phone:h-9 phone:px-3 phone:text-[13.5px]",
                            cur.minutes === m ? "border-foreground bg-foreground text-background" : "border-tea-green-700 bg-card"
                          )}
                        >
                          {m ? minutesText(Number(m)) : t("qp.usualTime")}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1">
                {many && !cur.declined && (
                  <button
                    type="button"
                    disabled={!cur.price}
                    onClick={() => setDrafts((all) => all.map((d) => (d.declined ? d : { ...d, price: cur.price })))}
                    className="text-[12.5px] font-semibold text-primary disabled:opacity-40"
                  >
                    {t("qp.samePrice")}
                  </button>
                )}
                {!cur.declined && (
                  <button
                    type="button"
                    onClick={() => update(sel, { declined: true, price: "", minutes: "" })}
                    className="text-[12.5px] font-semibold text-muted-foreground"
                  >
                    {t("qp.dontDo")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mx-4 mb-4 mt-3.5 rounded-[14px] border border-dashed border-tea-green-600 px-3.5 py-3 text-[13px] leading-normal md:mx-5">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {quote.clientName ? t("qp.willGet", { name: quote.clientName }) : t("qp.theyWillGet")}
            </p>
            {preview ? (
              <p className="whitespace-pre-line">{preview}</p>
            ) : (
              <p className="text-muted-foreground">{t("qp.previewHint")}</p>
            )}
          </div>
        </div>

        <div className="border-t border-border px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:pb-5 md:pl-5 md:pr-[5.5rem]">
          {error && (
            <p role="alert" className="mb-2 text-[13px] text-red-600">
              {error}
            </p>
          )}
          {!ready && nextOpen >= 0 && items[sel] && (items[sel].declined || items[sel].priceMinor !== null) ? (
            <button
              type="button"
              onClick={() => setSel(nextOpen)}
              className="h-14 w-full rounded-[14px] bg-primary text-[17px] font-bold text-primary-foreground md:h-[50px] md:text-base"
            >
              {t("qp.nextDesign", { n: nextOpen + 1 })}
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!ready || sending}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[17px] font-bold text-primary-foreground disabled:bg-tea-green-700 disabled:text-tea-green-300 md:h-[50px] md:text-base"
            >
              {sending ? (
                t("qp.sending")
              ) : ready ? (
                <>
                  <Check className="h-5 w-5" aria-hidden="true" /> {t("qp.send", { name })}
                </>
              ) : many ? (
                t("qp.priceAll", { total: quote.items.length, done })
              ) : (
                t("qp.enterPrice")
              )}
            </button>
          )}
        </div>
      </div>
      <PhotoViewer
        photoIds={quote.items.map((it) => it.photoId)}
        index={photoAt}
        onIndex={setPhotoAt}
        onClose={() => setPhotoAt(null)}
        title={t("qp.designFrom", { name })}
      />
    </div>
  );
}
