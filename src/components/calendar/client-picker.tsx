"use client";

/**
 * Step one of a desk booking: who is it for?
 *
 * One search box, because the person at the desk has a phone to their ear or
 * a client in front of them and will type whatever they have — "sio kel",
 * "07700 900", an email. The list sorts by whichever column header is
 * clicked; the search itself runs on the server a page at a time, since a
 * salon's client book runs to thousands once DaySmart's is imported.
 */

import { useEffect, useRef, useState } from "react";
import { Ban, ChevronRight, Footprints, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { DialogTitle } from "@/components/ui/dialog";
import { initialsFor } from "@/lib/channels";
import { speakablePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/language-provider";
import type { Translate } from "@/lib/i18n";

export interface ClientRow {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** Their most recent patch test, "YYYY-MM-DD", if one is on record. */
  patchTestAt?: string | null;
  /** Set when they have no number of their own and are reached through this client's. */
  contactLead?: { id: string; name: string | null; phone: string | null } | null;
  /** Other clients with exactly the same name: shown as a possible duplicate. */
  possibleDuplicates?: number;
  lastVisit: string | null;
  visits: number;
  nextBooking: string | null;
}

const PAGE = 50;

interface ClientPickerProps {
  timeZone: string;
  onPick: (client: ClientRow) => void;
  /** Absent when a walk-in makes no sense, e.g. changing a booking's client. */
  onWalkIn?: () => void;
  onBlockInstead?: () => void;
  /** The heading: "Who's it for?". */
  title: string;
  /** Over the heading: "New booking · step 1 of 2". */
  kicker?: string;
  /** Under the heading: the slot being booked, as chips. */
  context?: React.ReactNode;
  onClose: () => void;
}

function shortDate(iso: string, timeZone: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone });
}

function shortDateTime(iso: string, timeZone: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

/** The round close button in the corner of the booking pop-ups. */
export function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("common.close")}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tea-green-900 text-muted-foreground hover:bg-tea-green-800 hover:text-foreground"
    >
      <X className="h-[18px] w-[18px]" />
    </button>
  );
}

/** Initials in a circle: sage for someone who has been in, warm for someone new. */
export function ClientAvatar({ name, regular, className }: { name: string | null; regular: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-sm font-bold",
        regular ? "bg-tea-green-700 text-tea-green-100" : "bg-papaya-whip-600 text-light-bronze-200",
        className
      )}
    >
      {initialsFor(name, "?")}
    </span>
  );
}

/**
 * Step one of a desk booking, and of changing a booking's client: one big
 * search box over a list of people. Before anything is typed the list is
 * the clients seen most recently, who are most often the ones on the phone.
 */
export function ClientPicker({
  timeZone,
  onPick,
  onWalkIn,
  onBlockInstead,
  title,
  kicker,
  context,
  onClose,
}: ClientPickerProps) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { t, locale } = useT();
  const typed = q.trim();

  useEffect(() => {
    if (mode === "search") searchRef.current?.focus();
  }, [mode]);

  // Debounced, and each response checked against the request that is still
  // wanted: typing "sio" then "siobhan" must not let the slower "sio" reply
  // land last and overwrite the right answer.
  useEffect(() => {
    if (mode !== "search") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams(
          typed
            ? { q: typed, sort: "firstName", dir: "asc", limit: String(PAGE) }
            : { sort: "lastVisit", dir: "desc", limit: String(PAGE) }
        );
        const res = await apiFetch(`/api/clients?${params}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Search failed");
        setRows(data.clients ?? []);
        setTotal(data.total ?? 0);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(t("picker.couldNotLoad"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [typed, mode, t]);

  const header = (
    <div className="flex shrink-0 items-start gap-4 px-6 pb-4 pt-6 max-md:px-4 max-md:pt-4">
      <div className="grid min-w-0 flex-1 gap-2.5">
        {kicker && (
          <span className="text-xs font-bold uppercase tracking-[0.07em] text-tea-green-200">{kicker}</span>
        )}
        <DialogTitle className="font-heading text-[26px] font-extrabold leading-tight max-md:text-[22px]">
          {mode === "new" ? t("picker.newClient") : title}
        </DialogTitle>
        {context}
      </div>
      <CloseButton onClose={onClose} />
    </div>
  );

  if (mode === "new") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <NewClientForm initial={q} onCancel={() => setMode("search")} onCreated={onPick} />
      </div>
    );
  }

  const hasOptions = Boolean(onWalkIn || onBlockInstead);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="shrink-0 px-6 max-md:px-4">
        <label className="relative block">
          <span className="sr-only">{t("picker.searchLabel")}</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("picker.searchPlaceholder")}
            className="h-[52px] w-full rounded-[14px] border-[1.5px] border-tea-green-500 bg-card pl-12 pr-4 text-base text-foreground placeholder:text-muted-foreground focus:border-tea-green-300 focus:outline-none focus:ring-3 focus:ring-tea-green-800"
          />
        </label>
      </div>

      <div
        aria-live="polite"
        className="shrink-0 px-6 pb-1.5 pt-4 text-xs font-bold uppercase tracking-[0.07em] text-muted-foreground max-md:px-4"
      >
        {error ?? (loading ? t("picker.searching") : typed ? t("picker.matches") : t("picker.recent"))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 md:max-h-[380px] max-md:px-1">
        {rows.map((c) => {
          const regular = c.visits > 0;
          const reach = c.phone ? speakablePhone(c.phone) : reachedThrough(c, t);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c)}
              className="flex w-full items-center gap-3.5 rounded-[14px] px-3 py-2.5 text-left hover:bg-tea-green-900 focus-visible:bg-tea-green-900 focus-visible:outline-none max-md:min-h-16 max-md:rounded-none max-md:border-b max-md:border-tea-green-900"
            >
              <ClientAvatar name={c.name} regular={regular} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold max-md:text-base">
                  {c.name ?? t("form.unnamedClient")}
                  <DuplicateFlag client={c} className="ml-2" />
                </span>
                {reach && <span className="block truncate text-[13px] text-muted-foreground">{reach}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 max-md:hidden">
                <span className={cn("text-[12.5px] font-semibold", regular ? "text-tea-green-200" : "text-light-bronze-300")}>
                  {regular && c.lastVisit
                    ? t(c.visits === 1 ? "picker.visitLast" : "picker.visitsLast", {
                        n: c.visits,
                        date: shortDate(c.lastVisit, timeZone, locale),
                      })
                    : t("picker.newClient")}
                </span>
                {c.nextBooking && (
                  <span className="rounded-full bg-papaya-whip-600 px-2 py-0.5 text-[11.5px] font-semibold text-light-bronze-200">
                    {t("picker.bookedFor", { when: shortDateTime(c.nextBooking, timeZone, locale) })}
                  </span>
                )}
              </span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-tea-green-400" aria-hidden="true" />
            </button>
          );
        })}

        {!loading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              {typed ? t("picker.nobodyNamed", { q: typed }) : t("picker.noClients")}
            </p>
            {typed && (
              <Button type="button" onClick={() => setMode("new")} className="h-10 px-4">
                {t("picker.addNamed", { q: typed })}
              </Button>
            )}
          </div>
        )}
        {!loading && total > rows.length && (
          <p className="px-3 py-2 text-center text-xs text-muted-foreground">
            {t("picker.more", { n: total - rows.length })}
          </p>
        )}
      </div>

      <div
        className={cn(
          "mt-2 grid shrink-0 gap-2.5 border-t border-tea-green-800 px-6 py-4 max-md:px-4 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))]",
          hasOptions ? "grid-cols-3 max-md:grid-cols-2" : "grid-cols-1"
        )}
      >
        <button
          type="button"
          onClick={() => setMode("new")}
          className={cn(
            "flex h-14 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-tea-green-700 bg-card text-sm font-semibold hover:border-tea-green-500 hover:bg-tea-green-900",
            "max-md:col-span-2 max-md:h-[52px] max-md:border-0 max-md:bg-primary max-md:text-base max-md:font-bold max-md:text-primary-foreground max-md:hover:bg-tea-green-100",
            !hasOptions && "max-md:col-span-1"
          )}
        >
          <UserPlus className="h-[18px] w-[18px]" aria-hidden="true" />
          {t("picker.newClient")}
        </button>
        {onWalkIn && (
          <button
            type="button"
            onClick={onWalkIn}
            className="flex h-14 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-tea-green-700 bg-card text-sm font-semibold hover:border-tea-green-500 hover:bg-tea-green-900 max-md:h-12"
          >
            <Footprints className="h-[18px] w-[18px] text-tea-green-200" aria-hidden="true" />
            {t("picker.walkInShort")}
          </button>
        )}
        {onBlockInstead && (
          <button
            type="button"
            onClick={onBlockInstead}
            className="flex h-14 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-tea-green-700 bg-card text-sm font-semibold text-muted-foreground hover:border-tea-green-500 hover:text-foreground max-md:h-12"
          >
            <Ban className="h-[18px] w-[18px]" aria-hidden="true" />
            {t("picker.blockShort")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Add a client without leaving the booking.
 *
 * Whatever was typed in the search box comes across as the name, since a
 * search that found nobody is usually the name of the person to add.
 */
function NewClientForm({
  initial,
  onCancel,
  onCreated,
}: {
  initial: string;
  onCancel: () => void;
  onCreated: (client: ClientRow) => void;
}) {
  const looksLikeName = initial && !/[\d@]/.test(initial);
  const space = initial.trim().indexOf(" ");
  const [firstName, setFirstName] = useState(
    looksLikeName ? (space === -1 ? initial.trim() : initial.trim().slice(0, space)) : ""
  );
  const [lastName, setLastName] = useState(
    looksLikeName && space !== -1 ? initial.trim().slice(space + 1) : ""
  );
  const [phone, setPhone] = useState(!looksLikeName && /\d/.test(initial) ? initial : "");
  const [email, setEmail] = useState(initial.includes("@") ? initial : "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ClientRow | null>(null);
  // The clash was on the number: maybe a family sharing a phone.
  const [numberTaken, setNumberTaken] = useState(false);
  const { t } = useT();

  const save = async (contactThrough = false) => {
    setSaving(true);
    setError(null);
    setExisting(null);
    setNumberTaken(false);
    try {
      const res = await apiFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, phone, email, notes, contactThrough }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.existing) {
        setError(data.error);
        setNumberTaken(data.matched === "phone");
        setExisting({
          ...data.existing,
          lastVisit: null,
          visits: 0,
          nextBooking: null,
        });
        return;
      }
      if (!res.ok) {
        setError(data.error || t("picker.couldNotAdd"));
        return;
      }
      onCreated(data.client);
    } catch {
      setError(t("common.noServer"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="grid min-h-0 content-start gap-3 overflow-y-auto px-6 pb-6 max-md:px-4 max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      onSubmit={(e) => {
        e.preventDefault();
        if (firstName.trim() && !saving) save();
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t("picker.firstName")} id="client-first">
          <Input
            id="client-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field label={t("picker.lastName")} id="client-last">
          <Input id="client-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label={t("picker.phone")} id="client-phone">
          <Input
            id="client-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07700 900123"
          />
        </Field>
        <Field label={t("picker.email")} id="client-email">
          <Input
            id="client-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("picker.notes")} id="client-notes">
        <Textarea id="client-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>

      {error && (
        <p className="text-xs text-red-600">
          {error}{" "}
          {existing && (
            <button
              type="button"
              className="underline underline-offset-2 text-foreground"
              onClick={() => onCreated(existing)}
            >
              {t("picker.bookInstead", { name: existing.name ?? t("picker.them") })}
            </button>
          )}
          {existing && numberTaken && (
            <>
              {t("picker.or")}
              <button
                type="button"
                className="underline underline-offset-2 text-foreground"
                onClick={() => save(true)}
              >
                {t("picker.addThrough", { name: firstName.trim() || t("picker.them"), via: existing.name ?? t("picker.their") })}
              </button>
            </>
          )}
        </p>
      )}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" className="h-12" onClick={onCancel} disabled={saving}>
          {t("picker.backToSearch")}
        </Button>
        <Button type="submit" className="h-12 px-6 text-[15px] font-bold" disabled={!firstName.trim() || saving}>
          {saving ? t("common.saving") : t("picker.saveContinue")}
        </Button>
      </div>
    </form>
  );
}

export function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 min-w-0">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** "via Claire Burns · 07700 900 721", for a client with no number of their own. */
export function reachedThrough(c: Pick<ClientRow, "phone" | "contactLead">, t: Translate): string | null {
  if (c.phone || !c.contactLead) return null;
  const via = c.contactLead;
  return [t("picker.via", { name: via.name ?? t("picker.anotherClient") }), via.phone && speakablePhone(via.phone)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Flags a client who shares their exact name with another record: most often
 * a child first booked on a parent's phone who has since rung from their own,
 * which makes a second record the desk is best placed to spot.
 */
export function DuplicateFlag({ client, className }: { client: ClientRow; className?: string }) {
  const { t } = useT();
  const n = client.possibleDuplicates ?? 0;
  if (n === 0) return null;
  return (
    <span
      title={n === 1 ? t("dup.oneTitle", { name: client.name ?? "" }) : t("dup.manyTitle", { n, name: client.name ?? "" })}
      className={cn(
        "inline-block rounded-md border border-papaya-whip-400 bg-papaya-whip-700 px-1.5 py-0.5 text-[11px] font-normal text-papaya-whip-100 whitespace-nowrap align-middle",
        className
      )}
    >
      {t("dup.label")}
    </span>
  );
}

/**
 * For a client reached through someone else's number: where their texts go,
 * and the two ways out of it. Giving them their own number sends their texts
 * there; unlinking (only once they have one) stops the other number managing
 * their bookings.
 */
export function ClientLink({ client }: { client: ClientRow }) {
  const [phone, setPhone] = useState(client.phone);
  const [via, setVia] = useState(client.contactLead ?? null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Who they were linked to, to say so once unlinked here.
  const [unlinkedFrom, setUnlinkedFrom] = useState<string | null>(null);
  const { t } = useT();
  if (!via) {
    return unlinkedFrom && phone ? (
      <p className="mt-1 text-xs text-muted-foreground">
        {t("link.unlinked", { phone: speakablePhone(phone), name: unlinkedFrom })}
      </p>
    ) : null;
  }

  const change = async (body: { phone?: string; unlink?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 403 ? t("link.ownerOnly") : data.error || t("link.couldNotSave"));
        return;
      }
      setPhone(data.client.phone);
      if (!data.client.contactLead) setUnlinkedFrom(via?.name ?? t("picker.them"));
      setVia(data.client.contactLead);
      setAdding(false);
    } catch {
      setError(t("common.noServer"));
    } finally {
      setBusy(false);
    }
  };

  const viaName = via.name ?? t("link.linkedTo");
  return (
    <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
      <p>
        {phone
          ? t("link.ownNumber", { phone: speakablePhone(phone), name: viaName })
          : via.phone
            ? t("link.noNumberOn", { name: viaName, phone: speakablePhone(via.phone) })
            : t("link.noNumber", { name: viaName })}
      </p>
      {adding ? (
        <div className="flex items-center gap-2">
          <Input
            type="tel"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Inside the booking form: Enter saves the number, not the booking.
              if (e.key === "Enter") {
                e.preventDefault();
                if (draft.trim() && !busy) change({ phone: draft });
              }
            }}
            placeholder="07700 900123"
            className="h-7 w-40 text-xs"
            autoFocus
          />
          <Button type="button" size="sm" className="h-7" disabled={!draft.trim() || busy} onClick={() => change({ phone: draft })}>
            {t("common.save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setAdding(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex gap-3">
          {!phone && (
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setAdding(true)}>
              {t("link.addOwn")}
            </button>
          )}
          {phone && (
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              disabled={busy}
              onClick={() => change({ unlink: true })}
            >
              {t("link.unlinkFrom", { name: viaName })}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
