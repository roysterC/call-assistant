"use client";

/**
 * The pieces of the Callbacks page: a person waiting, as a card in the list,
 * and as the full view beside it (or in a sheet on a phone), with what they
 * said, what to do about it, and enough about them to ring ready.
 */

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { CalendarPlus, Check, MessageCircle, Phone, RotateCcw, StickyNote, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/components/providers/language-provider";
import { CHANNEL_META, avatarColorFor, initialsFor, type Channel } from "@/lib/channels";
import { DATE_FNS_LOCALE, INTL_LOCALE, clockTime, type Clock, type Lang, type MessageKey, type Translate } from "@/lib/i18n";
import type { VisitSummaryJson } from "@/lib/client-summary";
import { cn } from "@/lib/utils";
import { withAsOrg } from "@/lib/api-fetch";

export interface CallbackRow {
  id: string;
  status: string;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assignedTo: string;
  message: string | null;
  couldNotBook: { reason: string; service: string | null; stylist: string | null; startsAt: string | null } | null;
  attempts: number;
  lastAttemptAt: string | null;
  handledBy: string | null;
  resultNote: string | null;
  channel: string | null;
  chat: { channel: string; id: string } | null;
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    notes: string | null;
    contact: { name: string | null; phone: string | null } | null;
  };
  client: VisitSummaryJson | null;
}

export const DONE_OUTCOMES = ["booked", "sorted", "not_needed"] as const;
export type DoneOutcome = (typeof DONE_OUTCOMES)[number];

const OUTCOME_KEYS = ["booked", "sorted", "not_needed", "converted", "no_answer", "not_interested", "follow_up", "other"] as const;
export function outcomeLabel(t: Translate, outcome: string | null, status: string): string {
  if (outcome && (OUTCOME_KEYS as readonly string[]).includes(outcome)) {
    return t(`callbacks.outcome.${outcome as (typeof OUTCOME_KEYS)[number]}` as MessageKey);
  }
  return status === "missed" ? t("callbacks.status.missed") : t("callbacks.status.completed");
}

/** The callback's channel as the inbox names it; null when not known. */
function channelOf(cb: CallbackRow): Channel | null {
  if (cb.channel === "call") return "phone";
  if (cb.channel && cb.channel in CHANNEL_META) return cb.channel as Channel;
  return null;
}

export function displayName(cb: CallbackRow, t: Translate): string {
  return cb.lead.name?.trim() || cb.lead.phone || t("callbacks.someone");
}

/** "waiting 45 min", "waiting 3h", "since yesterday", "waiting 4 days". */
export function waitText(createdAt: string, now: number, t: Translate): { text: string; tone: "calm" | "warm" | "late" } {
  const min = Math.max(1, Math.round((now - new Date(createdAt).getTime()) / 60_000));
  const tone = min >= 24 * 60 ? "late" : min >= 120 ? "warm" : "calm";
  if (min < 60) return { text: t("callbacks.waitingMin", { n: min }), tone };
  if (min < 24 * 60) return { text: t("callbacks.waitingHours", { n: Math.round(min / 60) }), tone };
  if (min < 48 * 60) return { text: t("callbacks.waitingYesterday"), tone };
  return { text: t("callbacks.waitingDays", { n: Math.floor(min / (24 * 60)) }), tone };
}

const TONE = { calm: "text-muted-foreground", warm: "text-amber-700", late: "text-red-700" } as const;

/** "11:02", "Yesterday 3pm", "Thu 13 Nov, 3pm": in the salon's time zone. */
export function whenText(iso: string, timeZone: string, lang: Lang, clock: Clock, t: Translate): string {
  const at = new Date(iso);
  const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const today = dayOf(new Date());
  const yesterday = dayOf(new Date(Date.now() - 86_400_000));
  const time = clockTime(at, clock, timeZone);
  if (dayOf(at) === today) return time;
  if (dayOf(at) === yesterday) return `${t("callbacks.yesterday")} ${time}`;
  const day = at.toLocaleDateString(INTL_LOCALE[lang], { weekday: "short", day: "numeric", month: "short", timeZone });
  return `${day}, ${time}`;
}

/** "3 weeks ago". */
export function agoText(iso: string, lang: Lang): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true, locale: DATE_FNS_LOCALE[lang] });
}

function Avatar({ cb, size, t }: { cb: CallbackRow; size: "md" | "lg"; t: Translate }) {
  const name = displayName(cb, t);
  const ch = channelOf(cb);
  const meta = ch ? CHANNEL_META[ch] : null;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "lg" ? "h-[54px] w-[54px] text-lg" : "h-[42px] w-[42px] text-sm",
        avatarColorFor(cb.lead.id)
      )}
      aria-hidden="true"
    >
      {initialsFor(cb.lead.name, cb.lead.phone ?? "?")}
      {meta && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-card text-white",
            meta.bg
          )}
          title={meta.label}
        >
          <meta.icon className="h-2.5 w-2.5" />
        </span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

function forText(cb: CallbackRow, t: Translate): string {
  return !cb.assignedTo || cb.assignedTo === "Team" || cb.assignedTo === "Anyone" ? t("callbacks.forAnyone") : t("callbacks.for", { name: cb.assignedTo });
}

/** What they want, in a line or two, for the list. */
function askText(cb: CallbackRow, t: Translate, timeZone: string, lang: Lang, clock: Clock): string {
  const b = cb.couldNotBook;
  if (b?.service && b.stylist && b.startsAt) {
    const wanted = t("callbacks.cantBookWanted", {
      service: b.service,
      stylist: b.stylist,
      when: whenText(b.startsAt, timeZone, lang, clock, t),
    });
    return cb.message ? `${wanted} ${cb.message}` : wanted;
  }
  return cb.message?.trim() || t("callbacks.noMessage");
}

export function CallbackCard({
  cb,
  selected,
  onPick,
  now,
  timeZone,
}: {
  cb: CallbackRow;
  selected: boolean;
  onPick: () => void;
  now: number;
  timeZone: string;
}) {
  const { t, lang, clock } = useT();
  const done = cb.status !== "pending";
  const wait = waitText(cb.createdAt, now, t);
  const phone = cb.lead.phone ?? cb.lead.contact?.phone ?? null;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card transition-colors",
        selected ? "lg:border-primary lg:ring-1 lg:ring-primary" : "border-border lg:hover:border-tea-green-600"
      )}
    >
      <button type="button" onClick={onPick} aria-current={selected ? "true" : undefined} className="flex w-full gap-3 p-3.5 text-left">
        <Avatar cb={cb} size="md" t={t} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-bold">{displayName(cb, t)}</span>
            <span className={cn("ml-auto shrink-0 text-xs font-semibold", done ? "text-primary" : TONE[wait.tone])}>
              {done ? outcomeLabel(t, cb.outcome, cb.status) : wait.text}
            </span>
          </span>
          <span className="line-clamp-2 text-[13.5px] leading-snug text-foreground/85">{askText(cb, t, timeZone, lang, clock)}</span>
          <span className="mt-0.5 flex flex-wrap gap-1.5">
            {cb.couldNotBook && !done && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-800">{t("callbacks.couldntBook")}</span>
            )}
            {done && cb.handledBy && (
              <span className="rounded-full bg-tea-green-900 px-2 py-0.5 text-xs font-semibold text-tea-green-200">
                {cb.handledBy}
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{forText(cb, t)}</span>
            {!done && cb.attempts > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {t("callbacks.tried", { n: cb.attempts })}
              </span>
            )}
          </span>
        </span>
      </button>
      {/* On a phone or an upright tablet: ring them straight from the list. */}
      {!done && (
        <div className="flex gap-2 px-3.5 pb-3.5 lg:hidden">
          {phone && (
            <a href={`tel:${phone}`} className={buttonVariants({ className: "h-12 flex-1 rounded-[13px] text-[15.5px] font-bold" })}>
              <Phone /> {t("callbacks.callShort")}
            </a>
          )}
          <button
            type="button"
            onClick={onPick}
            className={buttonVariants({ variant: "outline", className: "h-12 flex-1 rounded-[13px] text-[15px] font-semibold" })}
          >
            {t("callbacks.doneMenu")}
          </button>
        </div>
      )}
    </div>
  );
}

function chatHref(chat: { channel: string; id: string }): string {
  return withAsOrg(`/conversations?c=${encodeURIComponent(chat.id)}&ch=${encodeURIComponent(chat.channel)}`);
}

/** A booking for them in the diary: on the day they wanted, when known. */
export function bookHref(cb: CallbackRow, timeZone: string): string {
  const q = new URLSearchParams({ bookFor: cb.lead.id });
  if (cb.couldNotBook?.startsAt) q.set("date", new Date(cb.couldNotBook.startsAt).toLocaleDateString("en-CA", { timeZone }));
  return withAsOrg(`/calendar?${q}`);
}

export function CallbackDetail({
  cb,
  timeZone,
  busy,
  note,
  onNote,
  onDone,
  onNoAnswer,
  onUndo,
  onClose,
}: {
  cb: CallbackRow;
  timeZone: string;
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  onDone: (outcome: DoneOutcome) => void;
  onNoAnswer: () => void;
  onUndo: () => void;
  /** Set on a phone, where it is a sheet. */
  onClose?: () => void;
}) {
  const { t, lang, clock } = useT();
  const name = displayName(cb, t);
  const first = (cb.lead.name?.trim().split(/\s+/)[0] || name).trim();
  const done = cb.status !== "pending";
  const ch = channelOf(cb);
  const phone = cb.lead.phone ?? cb.lead.contact?.phone ?? null;
  const fromChat = cb.chat && cb.channel && cb.channel !== "call" ? cb.chat : null;
  const c = cb.client;
  const when = whenText(cb.createdAt, timeZone, lang, clock, t);
  const b = cb.couldNotBook;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 md:px-7 md:py-5">
        <Avatar cb={cb} size="lg" t={t} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-[22px] font-extrabold leading-tight">{name}</h2>
          <p className="truncate text-[13.5px] text-muted-foreground">
            {cb.lead.phone ??
              (cb.lead.contact?.name ? t("callbacks.through", { name: cb.lead.contact.name }) : t("callbacks.noNumber"))}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("callbacks.close")}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        )}
        <div className="flex w-full flex-wrap gap-2 lg:w-auto">
          {phone && (
            <a href={`tel:${phone}`} className={buttonVariants({ className: "h-11 flex-1 px-4 text-[15px] lg:flex-none" })}>
              <Phone /> {t("callbacks.callName", { name: first })}
            </a>
          )}
          {cb.chat ? (
            <Link href={chatHref(cb.chat)} className={buttonVariants({ variant: "outline", className: "h-11 flex-1 px-4 lg:flex-none" })}>
              <MessageCircle /> {CHANNEL_META[cb.chat.channel as Channel]?.label ?? t("callbacks.openChat")}
            </Link>
          ) : (
            phone && (
              <a href={`sms:${phone}`} className={buttonVariants({ variant: "outline", className: "h-11 flex-1 px-4 lg:flex-none" })}>
                <MessageCircle /> {t("callbacks.text")}
              </a>
            )
          )}
          <Link href={bookHref(cb, timeZone)} className={buttonVariants({ variant: "outline", className: "h-11 flex-1 px-4 lg:flex-none" })}>
            <CalendarPlus /> {t("callbacks.book")}
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-5 md:px-7 md:pb-28">
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby="said-heading">
              <h3 id="said-heading" className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {t("callbacks.whatTheySaid")}
              </h3>
              <p className="whitespace-pre-line rounded-2xl bg-muted px-4 py-3.5 text-[15.5px] leading-relaxed">
                {cb.message?.trim() ? `“${cb.message.trim()}”` : <span className="text-muted-foreground">{t("callbacks.noMessage")}</span>}
              </p>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                {ch === "phone"
                  ? t("callbacks.leftOnCall", { when })
                  : ch
                    ? t("callbacks.leftOnChat", { channel: CHANNEL_META[ch].label, when })
                    : t("callbacks.leftAt", { when })}
                {fromChat && (
                  <>
                    {" · "}
                    <Link href={chatHref(fromChat)} className="font-semibold text-primary hover:underline">
                      {t("callbacks.openChat")}
                    </Link>
                  </>
                )}
              </p>
            </section>

            {b && !done && (
              <section className="flex flex-wrap items-center gap-3 rounded-2xl border-[1.5px] border-red-200 bg-red-50 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-red-900">{t("callbacks.cantBookTitle")}</p>
                  {b.service && b.stylist && b.startsAt && (
                    <p className="mt-0.5 text-[13.5px] text-red-950/80">
                      {t("callbacks.cantBookWanted", {
                        service: b.service,
                        stylist: b.stylist,
                        when: whenText(b.startsAt, timeZone, lang, clock, t),
                      })}
                    </p>
                  )}
                  {b.reason && <p className="mt-0.5 text-[12.5px] text-red-950/70">{t("callbacks.cantBookWhy", { reason: b.reason })}</p>}
                </div>
                <Link href={bookHref(cb, timeZone)} className={buttonVariants({ className: "bg-foreground text-background hover:bg-foreground/90" })}>
                  {t("callbacks.bookIt")}
                </Link>
              </section>
            )}

            {!done ? (
              <section aria-labelledby="outcome-heading" className="rounded-2xl border border-border p-4">
                <h3 id="outcome-heading" className="text-[15px] font-bold">
                  {t("callbacks.howDidItGo")}
                </h3>
                <p className="text-[13px] text-muted-foreground">
                  {cb.attempts > 0 && cb.lastAttemptAt
                    ? `${t("callbacks.tried", { n: cb.attempts })} · ${t("callbacks.lastTried", {
                        when: whenText(cb.lastAttemptAt, timeZone, lang, clock, t),
                      })}`
                    : t("callbacks.howHint")}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {DONE_OUTCOMES.slice(0, 2).map((o) => (
                    <OutcomeButton key={o} disabled={busy} onClick={() => onDone(o)} icon={o === "booked" ? CalendarPlus : Check}>
                      {t(`callbacks.outcome.${o}`)}
                    </OutcomeButton>
                  ))}
                  <OutcomeButton disabled={busy} onClick={onNoAnswer} icon={RotateCcw}>
                    {t("callbacks.outcome.no_answer")}
                  </OutcomeButton>
                  <OutcomeButton disabled={busy} onClick={() => onDone("not_needed")} icon={X}>
                    {t("callbacks.outcome.not_needed")}
                  </OutcomeButton>
                </div>
                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-muted-foreground">{t("callbacks.noteLabel")}</span>
                  <Textarea
                    value={note}
                    onChange={(e) => onNote(e.target.value)}
                    rows={2}
                    placeholder={t("callbacks.notePlaceholder")}
                    className="mt-1 resize-none"
                  />
                </label>
              </section>
            ) : (
              <section className="flex items-center gap-3 rounded-2xl bg-tea-green-900 px-4 py-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{outcomeLabel(t, cb.outcome, cb.status)}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {t("callbacks.doneBy", {
                      name: cb.handledBy ?? "",
                      when: whenText(cb.completedAt ?? cb.updatedAt, timeZone, lang, clock, t),
                    }).replace(/^, /, "")}
                  </p>
                  {cb.resultNote && <p className="mt-1 text-[13px]">{cb.resultNote}</p>}
                </div>
                <Button variant="ghost" size="sm" disabled={busy} onClick={onUndo}>
                  {t("callbacks.undo")}
                </Button>
              </section>
            )}
          </div>

          <aside aria-labelledby="about-heading" className="flex flex-col gap-3">
            <h3 id="about-heading" className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {t("callbacks.about", { name: first })}
            </h3>
            <dl className="flex flex-col gap-2.5 rounded-2xl bg-muted p-3.5 text-[13.5px]">
              <Fact label={t("callbacks.lastIn")} value={c?.lastVisit ? agoText(c.lastVisit, lang) : t("callbacks.newToYou")} />
              {c?.usual && <Fact label={t("callbacks.usually")} value={`${c.usual.service} · ${c.usual.stylist}`} />}
              <Fact label={t("callbacks.visits")} value={String(c?.visits ?? 0)} />
              <Fact
                label={t("callbacks.nextBooking")}
                value={c?.next ? whenText(c.next.startsAt, timeZone, lang, clock, t) : t("callbacks.nothingBooked")}
              />
            </dl>
            {cb.lead.notes?.trim() && (
              <p className="flex gap-2 rounded-xl border border-cornsilk-600 bg-cornsilk-900 px-3.5 py-3 text-[13px] leading-snug">
                <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cornsilk-300" aria-hidden="true" />
                <span className="line-clamp-4 whitespace-pre-line">{cb.lead.notes.trim()}</span>
              </p>
            )}
            <Link href={withAsOrg(`/clients?client=${encodeURIComponent(cb.lead.id)}`)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("callbacks.openClient")} →
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

function OutcomeButton({
  children,
  onClick,
  disabled,
  icon: Icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  icon: typeof Check;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-[14px] border border-border bg-card text-[13.5px] font-semibold transition-colors hover:bg-tea-green-900 disabled:opacity-50"
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      {children}
    </button>
  );
}
