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
import { ArrowDown, ArrowUp, ArrowUpDown, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { speakablePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

export interface ClientRow {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
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
  onWalkIn: () => void;
}

function shortDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
}

function shortDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

export function ClientPicker({ timeZone, onPick, onWalkIn }: ClientPickerProps) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("firstName");
  const [dir, setDir] = useState<Dir>("asc");
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
        setError("Could not load clients.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q, sort, dir, mode]);

  const toggleSort = (key: SortKey) => {
    if (key === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDir("asc");
    }
  };

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
            placeholder="Search by name, number or email"
            className="pl-8"
            aria-label="Search clients"
          />
        </div>
        <Button onClick={() => setMode("new")} className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          New client
        </Button>
      </div>

      <div className="rounded-md border border-border overflow-auto max-h-[50vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-popover">
            <tr className="border-b border-border text-left">
              <SortHeader label="First name" col="firstName" sort={sort} dir={dir} onSort={toggleSort} />
              <SortHeader label="Last name" col="lastName" sort={sort} dir={dir} onSort={toggleSort} />
              <SortHeader label="Phone" col="phone" sort={sort} dir={dir} onSort={toggleSort} />
              <SortHeader
                label="Email"
                col="email"
                sort={sort}
                dir={dir}
                onSort={toggleSort}
                className="hidden md:table-cell"
              />
              <th className="hidden sm:table-cell px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
                Last visit
              </th>
              <th className="hidden lg:table-cell px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
                Next booking
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                tabIndex={0}
                onClick={() => onPick(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(c);
                  }
                }}
                className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <td className="px-3 py-2 font-medium">{c.firstName || "—"}</td>
                <td className="px-3 py-2 font-medium">{c.lastName || ""}</td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {c.phone ? speakablePhone(c.phone) : ""}
                </td>
                <td className="hidden md:table-cell px-3 py-2 text-muted-foreground truncate max-w-[14rem]">
                  {c.email ?? ""}
                </td>
                <td className="hidden sm:table-cell px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {c.lastVisit ? shortDate(c.lastVisit, timeZone) : "New client"}
                </td>
                <td className="hidden lg:table-cell px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {c.nextBooking ? shortDateTime(c.nextBooking, timeZone) : ""}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {q ? (
                    <>
                      No client matches &ldquo;{q}&rdquo;.{" "}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => setMode("new")}
                      >
                        Add them as a new client
                      </button>
                    </>
                  ) : (
                    "No clients yet."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span aria-live="polite">
          {error ??
            (loading
              ? "Searching…"
              : total > rows.length
                ? `Showing ${rows.length} of ${total}. Type more to narrow it down.`
                : `${total} client${total === 1 ? "" : "s"}`)}
        </span>
        <button
          type="button"
          onClick={onWalkIn}
          className="underline underline-offset-2 hover:text-foreground shrink-0"
        >
          Walk-in, no details
        </button>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  col,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string;
  col: SortKey;
  sort: SortKey;
  dir: Dir;
  onSort: (col: SortKey) => void;
  className?: string;
}) {
  const active = sort === col;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn("px-1 py-1", className)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium whitespace-nowrap hover:bg-muted",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-50")} />
      </button>
    </th>
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

  const save = async () => {
    setSaving(true);
    setError(null);
    setExisting(null);
    try {
      const res = await apiFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, phone, email, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.existing) {
        setError(data.error);
        setExisting({
          ...data.existing,
          lastVisit: null,
          visits: 0,
          nextBooking: null,
        });
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not add that client.");
        return;
      }
      onCreated(data.client);
    } catch {
      setError("Could not reach the server.");
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
        <Field label="First name" id="client-first">
          <Input
            id="client-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field label="Last name" id="client-last">
          <Input id="client-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Phone" id="client-phone">
          <Input
            id="client-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="07700 900123"
          />
        </Field>
        <Field label="Email" id="client-email">
          <Input
            id="client-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes" id="client-notes">
        <Textarea id="client-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>

      {error && (
        <p className="text-xs text-red-400">
          {error}{" "}
          {existing && (
            <button
              type="button"
              className="underline underline-offset-2 text-foreground"
              onClick={() => onCreated(existing)}
            >
              Book {existing.name ?? "them"} instead
            </button>
          )}
        </p>
      )}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Back to search
        </Button>
        <Button type="submit" disabled={!firstName.trim() || saving}>
          {saving ? "Saving…" : "Save and continue"}
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
