"use client";

/**
 * One client, on the Clients page: beside the list on a wide screen, the
 * whole screen on a phone.
 *
 * Book, Call and Message at the top; then what their visits add up to
 * (visits, spend, usual gap, no-shows), what they usually have and when
 * they are due back, their patch test, the notes, what is coming up, and a
 * history that runs their bookings, the messages they left and their chats
 * together. Their name, number and email can be changed here, and the owner
 * can delete them (lib/client-delete says what goes with them).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  CalendarPlus,
  ChevronLeft,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  StickyNote,
  Trash2,
  TriangleAlert,
  Check,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { appointmentStatus, PATCH_TEST_BADGE, SMS_STATUS, STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/language-provider";
import { useMe } from "@/components/providers/me-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { CHANNEL_META, avatarColorFor, initialsFor, type Channel } from "@/lib/channels";
import { DATE_FNS_LOCALE, INTL_LOCALE, clockTime, type Clock, type Lang, type Translate } from "@/lib/i18n";
import type { VisitSummaryJson } from "@/lib/client-summary";

const STATUS_KEYS = ["booked", "completed", "cancelled", "no_show"] as const;
const OUTCOMES = ["booked", "sorted", "not_needed", "converted", "no_answer", "not_interested", "follow_up", "other"] as const;

interface ClientDetail {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** "YYYY-MM-DD", or null when none is on record. */
  patchTestAt: string | null;
  createdAt: string;
  contactLead: { id: string; name: string | null; phone: string | null } | null;
  dependents: { id: string; name: string | null }[];
}

interface Booking {
  id: string;
  bookingNumber: number | null;
  startsAt: string;
  serviceText: string;
  stylistName: string;
  status: string;
  amountMinor: number | null;
  patchTestRequired: boolean;
  confirmationSentAt: string | null;
  confirmationError: string | null;
}

interface CallbackItem {
  id: string;
  createdAt: string;
  notes: string | null;
  status: string;
  outcome: string | null;
  handledBy: string | null;
  channel: string | null;
  couldNotBook: boolean;
}

interface ChatItem {
  id: string;
  channel: string;
  lastMessageAt: string;
}

interface Profile {
  client: ClientDetail;
  appointments: Booking[];
  timeZone: string;
  summary: VisitSummaryJson;
  rebookText: { sentAt: string; service: string; openedAt: string | null } | null;
  callbacks: CallbackItem[];
  chats: ChatItem[];
}

/** "Tue 14 Oct 2026, 2:30pm" in the salon's time zone, on the reader's clock. */
function when(iso: string, timeZone: string, lang: Lang, clock: Clock): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(INTL_LOCALE[lang], { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone });
  const time = clockTime(d, clock, timeZone);
  return `${day}, ${clock === "12h" ? time.replace(":00", "") : time}`;
}

/** "14 Oct" (this year) or "14 Oct 2025". */
function shortDay(iso: string, timeZone: string, lang: Lang): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(INTL_LOCALE[lang], { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone });
}

/** A stored "YYYY-MM-DD" as "30 September 2026". */
function longDay(day: string, locale: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function chatHref(c: { channel: string; id: string }): string {
  return withAsOrg(`/conversations?c=${encodeURIComponent(c.id)}&ch=${encodeURIComponent(c.channel)}`);
}

function gapText(days: number | null, t: Translate): string {
  if (days === null) return "–";
  return days >= 10 ? t("client.weeks", { n: Math.round(days / 7) }) : t("client.days", { n: days });
}

export function ClientProfile({
  clientId,
  onClose,
  onChanged,
}: {
  clientId: string;
  /** Back to the list (a phone), or nothing chosen (after a delete). */
  onClose: () => void;
  /** The list's copy is stale: reload it. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [testDay, setTestDay] = useState("");
  const [saving, setSaving] = useState<"notes" | "test" | "details" | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [saved, setSaved] = useState<string | null>(null);
  const { t, lang, locale, clock } = useT();
  const me = useMe();
  const { confirm, notify } = useDialogs();
  // Members can change a client but not delete one; the API refuses them too.
  const canDelete = me !== null && me.role !== "member";

  useEffect(() => {
    let live = true;
    apiFetch(`/api/clients/${clientId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Profile) => {
        if (!live) return;
        setData(d);
        setNotes(d.client.notes ?? "");
        setTestDay(d.client.patchTestAt ?? todayLocal());
      })
      .catch(() => live && setError(t("client.loadFailed")));
    return () => {
      live = false;
    };
  }, [clientId, t]);

  const client = data?.client ?? null;

  function startEditing() {
    if (!client) return;
    setDetails({
      firstName: client.firstName ?? client.name ?? "",
      lastName: client.lastName ?? "",
      phone: client.phone ?? "",
      email: client.email ?? "",
    });
    setSaved(null);
    setError(null);
    setEditing(true);
  }

  /** Only what changed is sent, so an untouched number is not re-checked. */
  async function saveDetails() {
    if (!client) return;
    const body: Record<string, string> = {};
    if (details.firstName.trim() !== (client.firstName ?? client.name ?? "")) body.firstName = details.firstName;
    if (details.lastName.trim() !== (client.lastName ?? "")) body.lastName = details.lastName;
    if (details.phone.trim() !== (client.phone ?? "")) body.phone = details.phone;
    if (details.email.trim() !== (client.email ?? "")) body.email = details.email;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    await save("details", body);
  }

  async function save(kind: "notes" | "test" | "details", body: Record<string, unknown>) {
    if (!client || !data) return;
    setSaving(kind);
    setError(null);
    setSaved(null);
    try {
      const res = await apiFetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || t("client.saveFailed"));
        return;
      }
      setData({
        ...data,
        client: {
          ...client,
          name: d.client.name,
          firstName: d.client.firstName,
          lastName: d.client.lastName,
          phone: d.client.phone,
          email: d.client.email,
          contactLead: d.client.contactLead,
          notes: d.client.notes,
          patchTestAt: d.client.patchTestAt,
        },
      });
      // Notes being typed are kept when something else is saved.
      if (kind === "notes") setNotes(d.client.notes ?? "");
      if (kind === "details") setEditing(false);
      setSaved(kind === "notes" ? t("client.notesSaved") : kind === "test" ? t("client.testSaved") : t("client.detailsSaved"));
      onChanged();
    } finally {
      setSaving(null);
    }
  }

  async function deleteThisClient() {
    if (!client) return;
    const name = client.name ?? t("client.client");
    const yes = await confirm({
      title: t("client.deleteConfirmTitle", { name }),
      body: t("client.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!yes) return;
    setSaving("delete");
    try {
      const res = await apiFetch(`/api/clients/${client.id}`, { method: "DELETE" });
      if (!res.ok) {
        notify(t("client.deleteFailed"));
        return;
      }
      notify(t("client.deleted", { name }), "success");
      onChanged();
      onClose();
    } catch {
      notify(t("client.deleteFailed"));
    } finally {
      setSaving(null);
    }
  }

  if (!data || !client) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <BackBar onBack={onClose} t={t} />
        <div className="p-6">
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : (
            <div className="space-y-3" aria-hidden="true">
              <div className="h-14 w-2/3 animate-pulse rounded-xl bg-muted" />
              <div className="h-20 animate-pulse rounded-xl bg-muted" />
              <div className="h-32 animate-pulse rounded-xl bg-muted" />
            </div>
          )}
        </div>
      </div>
    );
  }

  const { appointments: bookings, timeZone, summary, rebookText } = data;
  const now = Date.now();
  const upcoming = bookings
    .filter((b) => b.status === "booked" && new Date(b.startsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = bookings.filter((b) => !upcoming.includes(b));
  // A booking flagged as needing a test, with none on record since.
  const testNeededFor = client.patchTestAt ? undefined : upcoming.find((b) => b.patchTestRequired);
  const notesChanged = notes.trim() !== (client.notes ?? "");
  const phone = client.phone ?? client.contactLead?.phone ?? null;
  const chat = data.chats[0] ?? null;
  const first = client.firstName ?? client.name?.split(/\s+/)[0] ?? t("client.client");

  const today = todayLocal();
  const dueLine = summary.due
    ? summary.due.on <= today
      ? t("client.dueBackNow", { date: longDay(summary.due.on, locale) })
      : t("client.dueBackOn", { date: longDay(summary.due.on, locale) })
    : summary.next
      ? t("client.bookedIn", { when: when(summary.next.startsAt, timeZone, lang, clock) })
      : null;
  const rebookLine =
    summary.due && rebookText && new Date(rebookText.sentAt).getTime() > now - 21 * 86_400_000
      ? `${t("client.rebookSent", { date: shortDay(rebookText.sentAt, timeZone, lang) })}${rebookText.openedAt ? ` ${t("client.rebookOpened")}` : ""}`
      : null;

  type HistoryItem = { key: string; at: string; node: React.ReactNode };
  const history: HistoryItem[] = [
    ...past.map((b) => ({ key: `b-${b.id}`, at: b.startsAt, node: <BookingRow b={b} timeZone={timeZone} testOnRecord={Boolean(client.patchTestAt)} /> })),
    ...data.callbacks.map((c) => ({
      key: `c-${c.id}`,
      at: c.createdAt,
      node: <CallbackRowView c={c} timeZone={timeZone} />,
    })),
    ...data.chats.map((c) => ({
      key: `m-${c.id}`,
      at: c.lastMessageAt,
      node: (
        <HistoryLine
          icon={<MessageCircle className="h-3.5 w-3.5" />}
          tone="bg-light-bronze-900 text-light-bronze-200"
          title={t("client.chatOn", { channel: CHANNEL_META[c.channel as Channel]?.label ?? c.channel })}
          sub={t("client.chatLast", { when: when(c.lastMessageAt, timeZone, lang, clock) })}
          right={
            <Link href={chatHref(c)} className="text-[13px] font-semibold text-primary hover:underline">
              {t("client.openChat")}
            </Link>
          }
        />
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackBar onBack={onClose} t={t} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Who they are */}
        <div className="flex items-center gap-3.5 px-4 pt-4 md:px-7 md:pt-6">
          <span
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold",
              avatarColorFor(client.id)
            )}
            aria-hidden="true"
          >
            {initialsFor(client.name, client.phone ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-heading text-[22px] font-extrabold leading-tight">{client.name ?? t("client.client")}</h2>
            <p className="truncate text-[13px] text-muted-foreground">
              {
                client.phone ??
                  (client.contactLead
                    ? client.contactLead.phone
                      ? t("client.throughOn", { name: client.contactLead.name ?? t("client.anotherClient"), phone: client.contactLead.phone })
                      : t("client.through", { name: client.contactLead.name ?? t("client.anotherClient") })
                    : null)
              }
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {t("client.since", { date: format(new Date(client.createdAt), "MMM yyyy", { locale: DATE_FNS_LOCALE[lang] }) })}
            </p>
          </div>
          {!editing && (
            <Button size="sm" variant="outline" onClick={startEditing} aria-label={t("client.editDetails")}>
              <Pencil />
              <span className="max-sm:hidden">{t("client.editDetails")}</span>
            </Button>
          )}
        </div>

        {editing && (
          <form
            className="mx-4 mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-border p-3 md:mx-7"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDetails();
            }}
          >
            <DetailField id="client-first-name" label={t("client.firstName")} value={details.firstName} onChange={(v) => setDetails({ ...details, firstName: v })} autoComplete="given-name" required />
            <DetailField id="client-last-name" label={t("client.lastName")} value={details.lastName} onChange={(v) => setDetails({ ...details, lastName: v })} autoComplete="family-name" />
            <DetailField
              id="client-phone"
              label={t("client.mobile")}
              type="tel"
              value={details.phone}
              onChange={(v) => setDetails({ ...details, phone: v })}
              autoComplete="tel"
              placeholder={client.contactLead ? t("client.through", { name: client.contactLead.name ?? t("client.anotherClient") }) : undefined}
            />
            <DetailField id="client-email" label={t("client.email")} type="email" value={details.email} onChange={(v) => setDetails({ ...details, email: v })} autoComplete="email" />
            <div className="col-span-2 flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={saving !== null || !details.firstName.trim()}>
                {saving === "details" ? t("common.saving") : t("client.saveDetails")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={saving !== null} onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}

        {/* Reach them, book them. On a phone these sit along the bottom instead. */}
        <div className="mt-4 hidden gap-2 border-b border-border px-7 pb-4 md:flex">
          <Link href={withAsOrg(`/calendar?bookFor=${encodeURIComponent(client.id)}`)} className={buttonVariants({ className: "h-10 px-4 text-sm" })}>
            <CalendarPlus /> {t("client.book")}
          </Link>
          {phone && (
            <a href={`tel:${phone}`} className={buttonVariants({ variant: "outline", className: "h-10 px-3.5 text-sm" })}>
              <Phone /> {t("client.call")}
            </a>
          )}
          {chat ? (
            <Link href={chatHref(chat)} className={buttonVariants({ variant: "outline", className: "h-10 px-3.5 text-sm" })}>
              <MessageCircle /> {CHANNEL_META[chat.channel as Channel]?.label ?? t("client.text")}
            </Link>
          ) : (
            phone && (
              <a href={`sms:${phone}`} className={buttonVariants({ variant: "outline", className: "h-10 px-3.5 text-sm" })}>
                <MessageCircle /> {t("client.text")}
              </a>
            )
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className={buttonVariants({ variant: "ghost", className: "h-10 px-3 text-sm" })} title={client.email}>
              <Mail /> <span className="max-w-40 truncate">{client.email}</span>
            </a>
          )}
        </div>

        {error && (
          <p role="alert" className="mx-4 mt-4 text-sm text-red-600 md:mx-7">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="mx-4 mt-4 text-sm text-tea-green-200 md:mx-7">
            {saved}
          </p>
        )}

        <div className="flex flex-col gap-5 px-4 pb-8 pt-4 md:px-7 md:pb-28 md:pt-5">
          {/* What their visits add up to */}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={String(summary.visits)} label={t("client.stat.visits")} />
            <Stat value={formatMoneyShort(summary.spentMinor)} label={t("client.stat.spent")} />
            <Stat value={gapText(summary.gapDays, t)} label={t("client.stat.gap")} />
            <Stat value={String(summary.noShows)} label={t("client.stat.noShows")} />
          </dl>

          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <div
              className={cn(
                "rounded-2xl border px-4 py-3",
                summary.due && summary.due.on <= today ? "border-cornsilk-500 bg-cornsilk-900" : "border-border"
              )}
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{t("client.usually")}</p>
              <p className="mt-1 text-sm font-semibold">
                {summary.usual ? t("client.usualWith", { service: summary.usual.service, stylist: summary.usual.stylist }) : t("client.noUsual")}
              </p>
              {dueLine && <p className="mt-0.5 text-[13px] text-muted-foreground">{dueLine}</p>}
              {rebookLine && <p className="mt-0.5 text-[13px] text-muted-foreground">{rebookLine}</p>}
            </div>

            {/* Patch test */}
            <section
              aria-labelledby="patch-test-heading"
              className={cn("rounded-2xl px-4 py-3", testNeededFor ? "bg-red-50" : client.patchTestAt ? "bg-tea-green-900" : "bg-muted")}
            >
              <h3 id="patch-test-heading" className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {t("client.patchTest")}
              </h3>
              <p className={cn("mt-1 text-sm font-semibold", testNeededFor && "text-red-800")}>
                {client.patchTestAt ? t("client.lastDone", { day: longDay(client.patchTestAt, locale) }) : t("client.noneOnRecord")}
              </p>
              {testNeededFor && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-red-900">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  {t("client.testNeededFor", { service: testNeededFor.serviceText, when: when(testNeededFor.startsAt, timeZone, lang, clock) })}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <label htmlFor="patch-test-day" className="sr-only">
                  {t("client.testDoneOn")}
                </label>
                <Input
                  id="patch-test-day"
                  type="date"
                  value={testDay}
                  max={todayLocal()}
                  onChange={(e) => setTestDay(e.target.value)}
                  className="h-8 w-[9.5rem] bg-card"
                />
                <Button size="sm" disabled={!testDay || saving !== null || testDay === client.patchTestAt} onClick={() => save("test", { patchTestAt: testDay })}>
                  {saving === "test" ? t("common.saving") : t("client.recordTest")}
                </Button>
                {client.patchTestAt && (
                  <Button size="sm" variant="ghost" disabled={saving !== null} onClick={() => save("test", { patchTestAt: null })}>
                    {t("client.clear")}
                  </Button>
                )}
              </div>
            </section>
          </div>

          {client.dependents.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {t("client.alsoBooksFor", { names: client.dependents.map((d) => d.name ?? t("client.someone")).join(", ") })}
            </p>
          )}

          {/* Notes */}
          <section aria-labelledby="notes-heading" className="rounded-2xl border border-cornsilk-600 bg-cornsilk-900 p-3">
            <h3 id="notes-heading" className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-cornsilk-200">
              <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
              {t("client.notes")}
            </h3>
            <Textarea
              aria-labelledby="notes-heading"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t("client.notesPlaceholder")}
              className="mt-1.5 border-cornsilk-600 bg-card"
            />
            {notesChanged && (
              <Button size="sm" className="mt-2" disabled={saving !== null} onClick={() => save("notes", { notes })}>
                {saving === "notes" ? t("common.saving") : t("client.saveNotes")}
              </Button>
            )}
          </section>

          {/* Coming up */}
          <section aria-labelledby="coming-heading">
            <h3 id="coming-heading" className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {t("client.comingUp")}
            </h3>
            {upcoming.length === 0 ? (
              <p className="rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">{t("client.nothingComing")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.map((b) => (
                  <li key={b.id} className="rounded-2xl bg-muted px-4 py-3">
                    <BookingRow b={b} timeZone={timeZone} testOnRecord={Boolean(client.patchTestAt)} upcoming />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* History */}
          <section aria-labelledby="history-heading">
            <h3 id="history-heading" className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {t("client.history")}
            </h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("client.noBookings")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {history.map((h) => (
                  <li key={h.key} className="py-2.5">
                    {h.node}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canDelete && (
            <section aria-labelledby="delete-heading" className="space-y-2 border-t pt-5">
              <h3 id="delete-heading" className="text-sm font-semibold">
                {t("client.deleteHeading")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {client.dependents.length > 0
                  ? t("client.deleteBlockedDependents", { names: client.dependents.map((d) => d.name ?? t("client.someone")).join(", ") })
                  : upcoming.length > 0
                    ? t("client.deleteBlockedUpcoming")
                    : t("client.deleteHint")}
              </p>
              <Button
                size="sm"
                variant="destructive"
                disabled={saving !== null || upcoming.length > 0 || client.dependents.length > 0}
                onClick={() => void deleteThisClient()}
              >
                <Trash2 />
                {t("client.deleteHeading")}
              </Button>
            </section>
          )}
        </div>
      </div>

      {/* A phone's actions, along the bottom. */}
      <div className="grid shrink-0 grid-cols-[1fr_1fr_1.3fr] gap-2 border-t border-border bg-card px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3 md:hidden">
        {phone ? (
          <a href={`tel:${phone}`} className={buttonVariants({ variant: "outline", className: "h-12 rounded-[14px] text-[15px]" })}>
            <Phone /> {t("client.call")}
          </a>
        ) : (
          <span />
        )}
        {chat ? (
          <Link href={chatHref(chat)} className={buttonVariants({ variant: "outline", className: "h-12 rounded-[14px] text-[15px]" })}>
            <MessageCircle /> {CHANNEL_META[chat.channel as Channel]?.label ?? t("client.text")}
          </Link>
        ) : phone ? (
          <a href={`sms:${phone}`} className={buttonVariants({ variant: "outline", className: "h-12 rounded-[14px] text-[15px]" })}>
            <MessageCircle /> {t("client.text")}
          </a>
        ) : (
          <span />
        )}
        <Link
          href={withAsOrg(`/calendar?bookFor=${encodeURIComponent(client.id)}`)}
          className={buttonVariants({ className: "h-12 rounded-[14px] text-base font-bold" })}
          aria-label={`${t("client.book")} ${first}`}
        >
          <CalendarPlus /> {t("client.book")}
        </Link>
      </div>
    </div>
  );
}

function BackBar({ onBack, t }: { onBack: () => void; t: Translate }) {
  return (
    <div className="flex shrink-0 items-center px-2 pt-2 md:hidden">
      <button type="button" onClick={onBack} className="flex h-10 items-center gap-1 rounded-lg px-2 text-[15px] font-semibold text-primary">
        <ChevronLeft className="h-5 w-5" /> {t("client.back")}
      </button>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-muted px-3.5 py-2.5">
      <dd className="font-heading text-[19px] font-extrabold tabular-nums">{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

function HistoryLine({
  icon,
  tone,
  title,
  sub,
  right,
}: {
  icon: React.ReactNode;
  tone: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", tone)} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {sub && <div className="text-[12.5px] text-muted-foreground">{sub}</div>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </div>
  );
}

function BookingRow({
  b,
  timeZone,
  testOnRecord,
  upcoming,
}: {
  b: Booking;
  timeZone: string;
  testOnRecord: boolean;
  upcoming?: boolean;
}) {
  const { t, lang, clock } = useT();
  const status = appointmentStatus(b.status);
  const textFailed = Boolean(b.confirmationError && !b.confirmationSentAt);
  const needsTest = b.patchTestRequired && !testOnRecord;
  const label = (STATUS_KEYS as readonly string[]).includes(b.status) ? t(`status.${b.status as (typeof STATUS_KEYS)[number]}`) : status.label;
  const icon = b.status === "completed" ? <Check className="h-3.5 w-3.5" /> : b.status === "booked" ? <CalendarPlus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />;
  const tone =
    b.status === "completed" ? "bg-tea-green-900 text-tea-green-200" : b.status === "booked" ? "bg-cornsilk-900 text-cornsilk-200" : "bg-red-50 text-red-800";
  const sub = (
    <>
      {upcoming ? when(b.startsAt, timeZone, lang, clock) : `${b.stylistName} · ${label}`}
      {(needsTest || textFailed) && (
        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
          {needsTest && <span className={cn(STATUS_BADGE, PATCH_TEST_BADGE)}>{t("client.testNeeded")}</span>}
          {textFailed && <span className={cn(STATUS_BADGE, SMS_STATUS.failed.className)}>{t("client.textFailed")}</span>}
        </span>
      )}
    </>
  );
  return (
    <HistoryLine
      icon={icon}
      tone={upcoming ? "bg-card text-primary" : tone}
      title={upcoming ? `${b.serviceText} · ${b.stylistName}` : b.serviceText}
      sub={sub}
      right={
        <>
          {!upcoming && <p className="text-[12.5px] text-muted-foreground">{shortDay(b.startsAt, timeZone, lang)}</p>}
          {b.amountMinor !== null && <p className="text-[13px] font-semibold">{formatMoney(b.amountMinor)}</p>}
        </>
      }
    />
  );
}

function CallbackRowView({ c, timeZone }: { c: CallbackItem; timeZone: string }) {
  const { t, lang } = useT();
  const outcome =
    c.status === "pending"
      ? t("client.waitingCallback")
      : c.outcome && (OUTCOMES as readonly string[]).includes(c.outcome)
        ? t(`callbacks.outcome.${c.outcome as (typeof OUTCOMES)[number]}`)
        : c.status === "missed"
          ? t("callbacks.status.missed")
          : t("callbacks.status.completed");
  return (
    <HistoryLine
      icon={<Phone className="h-3.5 w-3.5" />}
      tone="bg-papaya-whip-800 text-papaya-whip-200"
      title={c.couldNotBook ? t("client.couldNotBookMsg") : t("client.leftMessage")}
      sub={
        <>
          {c.notes?.trim() && <span className="line-clamp-2">“{c.notes.trim()}”</span>}
          <span>
            {outcome}
            {c.handledBy && c.status !== "pending" ? ` · ${c.handledBy}` : ""}
          </span>
        </>
      }
      right={<p className="text-[12.5px] text-muted-foreground">{shortDay(c.createdAt, timeZone, lang)}</p>}
    />
  );
}

function DetailField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        className="mt-1 h-8"
      />
    </div>
  );
}
