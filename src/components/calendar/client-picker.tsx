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
import { Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { DataTable, PersonCell, Pill, type ColumnDef } from "@/components/ui/data-table";
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

type SortKey = "firstName" | "lastName" | "phone" | "email";
type Dir = "asc" | "desc";

const PAGE = 50;

interface ClientPickerProps {
  timeZone: string;
  onPick: (client: ClientRow) => void;
  /** Absent when a walk-in makes no sense, e.g. changing a booking's client. */
  onWalkIn?: () => void;
  onBlockInstead?: () => void;
}

function shortDate(iso: string, timeZone: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
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

export function ClientPicker({
  timeZone,
  onPick,
  onWalkIn,
  onBlockInstead,
}: ClientPickerProps) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("firstName");
  const [dir, setDir] = useState<Dir>("asc");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { t, locale } = useT();

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
        const params = new URLSearchParams({ q, sort, dir, limit: String(PAGE) });
        const res = await apiFetch(`/api/clients?${params}`, {
          signal: controller.signal,
        });
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
  }, [q, sort, dir, mode, t]);

  const columns: ColumnDef<ClientRow>[] = [
    {
      // Sorted by first name; search finds a surname.
      id: "firstName",
      header: t("picker.client"),
      cell: ({ row: { original: c } }) => (
        <PersonCell
          name={c.name}
          badge={<DuplicateFlag client={c} />}
          detail={c.phone ? speakablePhone(c.phone) : reachedThrough(c, t)}
        />
      ),
    },
    {
      id: "email",
      header: t("picker.email"),
      meta: {
        className: "hidden max-w-[14rem] truncate text-muted-foreground md:table-cell",
        headerClassName: "hidden md:table-cell",
      },
      cell: ({ row: { original: c } }) => c.email ?? "",
    },
    {
      id: "lastVisit",
      header: t("picker.lastVisit"),
      enableSorting: false,
      meta: {
        className: "hidden whitespace-nowrap text-muted-foreground sm:table-cell",
        headerClassName: "hidden sm:table-cell",
      },
      cell: ({ row: { original: c } }) => (c.lastVisit ? shortDate(c.lastVisit, timeZone, locale) : t("picker.newClient")),
    },
    {
      id: "nextBooking",
      header: t("picker.nextBooking"),
      enableSorting: false,
      meta: { className: "hidden lg:table-cell", headerClassName: "hidden lg:table-cell" },
      cell: ({ row: { original: c } }) => (c.nextBooking ? <Pill>{shortDateTime(c.nextBooking, timeZone, locale)}</Pill> : null),
    },
  ];

  if (mode === "new") {
    return (
      <NewClientForm
        initial={q}
        onCancel={() => setMode("search")}
        onCreated={onPick}
      />
    );
  }

  return (
    <div className="grid gap-3 min-w-0">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("picker.searchPlaceholder")}
            className="pl-8"
            aria-label={t("picker.searchLabel")}
          />
        </div>
        <Button onClick={() => setMode("new")} className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          {t("picker.newClient")}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(c) => c.id}
        onRowClick={onPick}
        rowLabel={(c) => c.name ?? t("picker.rowLabel")}
        loading={loading}
        manualSorting
        sorting={[{ id: sort, desc: dir === "desc" }]}
        onSortingChange={(update) => {
          const next = typeof update === "function" ? update([{ id: sort, desc: dir === "desc" }]) : update;
          const first = next[0];
          if (!first) {
            setDir(dir === "asc" ? "desc" : "asc");
            return;
          }
          setSort(first.id as SortKey);
          setDir(first.desc ? "desc" : "asc");
        }}
        scrollClassName="max-h-[50vh] max-md:max-h-[60dvh]"
        empty={
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            {q ? (
              <>
                {t("picker.noMatch", { q })}{" "}
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setMode("new")}>
                  {t("picker.addAsNew")}
                </button>
              </>
            ) : (
              t("picker.noClients")
            )}
          </p>
        }
      />

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span aria-live="polite">
          {error ??
            (loading
              ? t("picker.searching")
              : total > rows.length
                ? t("picker.showing", { shown: rows.length, total })
                : t(total === 1 ? "picker.countOne" : "picker.countMany", { n: total }))}
        </span>
        <span className="flex gap-3 shrink-0">
          {onBlockInstead && (
            <button
              type="button"
              onClick={onBlockInstead}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("picker.blockInstead")}
            </button>
          )}
          {onWalkIn && (
            <button
              type="button"
              onClick={onWalkIn}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("picker.walkIn")}
            </button>
          )}
        </span>
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
      className="grid gap-3"
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
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {t("picker.backToSearch")}
        </Button>
        <Button type="submit" disabled={!firstName.trim() || saving}>
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
