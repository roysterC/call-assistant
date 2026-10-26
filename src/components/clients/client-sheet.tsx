"use client";

/**
 * One client, opened from the Clients page: how to reach them, their patch
 * test, their notes, and every booking they have had or have coming. All of
 * it can be changed here, their name, number and email included.
 */

import { useEffect, useState } from "react";
import { Mail, Pencil, Phone, TriangleAlert } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { formatMoney } from "@/lib/money";
import { appointmentStatus, PATCH_TEST_BADGE, SMS_STATUS, STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/language-provider";
import { INTL_LOCALE, clockTime, type Lang } from "@/lib/i18n";

const STATUS_KEYS = ["booked", "completed", "cancelled", "no_show"] as const;

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

/** "Tue 14 Oct 2026, 2:30pm" in the salon's clock (24-hour in Vietnamese). */
function when(iso: string, timeZone: string, lang: Lang): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(INTL_LOCALE[lang], { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone });
  const time = clockTime(d, lang, timeZone);
  return `${day}, ${lang === "en" ? time.replace(":00", "") : time}`;
}

/** A stored "YYYY-MM-DD" as "30 September 2026". */
function longDay(day: string, locale: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ClientSheet({
  clientId,
  onClose,
  onChanged,
}: {
  clientId: string | null;
  onClose: () => void;
  /** The list's copy is stale: reload it. */
  onChanged: () => void;
}) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [timeZone, setTimeZone] = useState("Europe/London");
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [testDay, setTestDay] = useState("");
  const [saving, setSaving] = useState<"notes" | "test" | "details" | null>(null);
  // Editing who they are: name, number, email.
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [saved, setSaved] = useState<string | null>(null);
  const { t, lang, locale } = useT();

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    setClient(null);
    setBookings([]);
    setError(null);
    setSaved(null);
    setEditing(false);
    apiFetch(`/api/clients/${clientId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!live) return;
        setClient(d.client);
        setBookings(d.appointments ?? []);
        setTimeZone(d.timeZone ?? "Europe/London");
        setNotes(d.client.notes ?? "");
        setTestDay(d.client.patchTestAt ?? todayLocal());
      })
      .catch(() => live && setError(t("client.loadFailed")));
    return () => {
      live = false;
    };
  }, [clientId, t]);

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
    if (!client) return;
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
      setClient({
        ...client,
        name: d.client.name,
        firstName: d.client.firstName,
        lastName: d.client.lastName,
        phone: d.client.phone,
        email: d.client.email,
        contactLead: d.client.contactLead,
        notes: d.client.notes,
        patchTestAt: d.client.patchTestAt,
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

  const now = Date.now();
  const upcoming = bookings
    .filter((b) => b.status === "booked" && new Date(b.startsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = bookings.filter((b) => !upcoming.includes(b));
  // A booking flagged as needing a test, with none on record since. Once the
  // desk records one, the flags on the bookings are answered.
  const testNeededFor = client?.patchTestAt ? undefined : upcoming.find((b) => b.patchTestRequired);
  const notesChanged = client !== null && notes.trim() !== (client.notes ?? "");

  return (
    <Sheet open={clientId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto gap-0">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg">{client?.name ?? (error ? t("client.client") : t("common.loading"))}</SheetTitle>
          {client && editing && (
            <form
              className="mt-2 grid grid-cols-2 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveDetails();
              }}
            >
              <DetailField
                id="client-first-name"
                label={t("client.firstName")}
                value={details.firstName}
                onChange={(v) => setDetails({ ...details, firstName: v })}
                autoComplete="given-name"
                required
              />
              <DetailField
                id="client-last-name"
                label={t("client.lastName")}
                value={details.lastName}
                onChange={(v) => setDetails({ ...details, lastName: v })}
                autoComplete="family-name"
              />
              <DetailField
                id="client-phone"
                label={t("client.mobile")}
                type="tel"
                value={details.phone}
                onChange={(v) => setDetails({ ...details, phone: v })}
                autoComplete="tel"
                placeholder={
                  client.contactLead
                    ? t("client.through", { name: client.contactLead.name ?? t("client.anotherClient") })
                    : undefined
                }
              />
              <DetailField
                id="client-email"
                label={t("client.email")}
                type="email"
                value={details.email}
                onChange={(v) => setDetails({ ...details, email: v })}
                autoComplete="email"
              />
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
          {client && !editing && (
            <div className="mt-1 space-y-1 text-sm">
              {client.phone ? (
                <a href={`tel:${client.phone}`} className="flex items-center gap-2 hover:underline">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {client.phone}
                </a>
              ) : client.contactLead ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  {client.contactLead.phone
                    ? t("client.throughOn", {
                        name: client.contactLead.name ?? t("client.anotherClient"),
                        phone: client.contactLead.phone,
                      })
                    : t("client.through", { name: client.contactLead.name ?? t("client.anotherClient") })}
                </p>
              ) : null}
              {client.email && (
                <a href={`mailto:${client.email}`} className="flex items-center gap-2 hover:underline">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  {client.email}
                </a>
              )}
              {client.dependents.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("client.alsoBooksFor", { names: client.dependents.map((d) => d.name ?? t("client.someone")).join(", ") })}
                </p>
              )}
              <Button size="xs" variant="outline" className="mt-1.5" onClick={startEditing}>
                <Pencil />
                {t("client.editDetails")}
              </Button>
            </div>
          )}
        </SheetHeader>

        {error && (
          <p role="alert" className="mx-4 mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="mx-4 mt-4 text-sm text-tea-green-200">
            {saved}
          </p>
        )}

        {client && (
          <div className="space-y-6 p-4">
            {/* Patch test */}
            <section aria-labelledby="patch-test-heading" className="space-y-2">
              <h3 id="patch-test-heading" className="text-sm font-semibold">
                {t("client.patchTest")}
              </h3>
              <p className="text-sm">
                {client.patchTestAt ? (
                  t("client.lastDone", { day: longDay(client.patchTestAt, locale) })
                ) : (
                  <span className="text-muted-foreground">{t("client.noneOnRecord")}</span>
                )}
              </p>
              {testNeededFor && (
                <p className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", PATCH_TEST_BADGE)}>
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  <span>
                    {t("client.testNeededFor", {
                      service: testNeededFor.serviceText,
                      when: when(testNeededFor.startsAt, timeZone, lang),
                    })}
                  </span>
                </p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="patch-test-day" className="block text-xs text-muted-foreground">
                    {t("client.testDoneOn")}
                  </label>
                  <Input
                    id="patch-test-day"
                    type="date"
                    value={testDay}
                    max={todayLocal()}
                    onChange={(e) => setTestDay(e.target.value)}
                    className="mt-1 h-8 w-40"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!testDay || saving !== null || testDay === client.patchTestAt}
                  onClick={() => save("test", { patchTestAt: testDay })}
                >
                  {saving === "test" ? t("common.saving") : t("client.recordTest")}
                </Button>
                {client.patchTestAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving !== null}
                    onClick={() => save("test", { patchTestAt: null })}
                  >
                    {t("client.clear")}
                  </Button>
                )}
              </div>
            </section>

            {/* Notes */}
            <section aria-labelledby="notes-heading" className="space-y-2">
              <h3 id="notes-heading" className="text-sm font-semibold">
                {t("client.notes")}
              </h3>
              <Textarea
                aria-labelledby="notes-heading"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder={t("client.notesPlaceholder")}
              />
              <Button
                size="sm"
                disabled={!notesChanged || saving !== null}
                onClick={() => save("notes", { notes })}
              >
                {saving === "notes" ? t("common.saving") : t("client.saveNotes")}
              </Button>
            </section>

            {/* Bookings */}
            <section aria-labelledby="bookings-heading" className="space-y-3">
              <h3 id="bookings-heading" className="text-sm font-semibold">
                {t("client.bookings")}
              </h3>
              {bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("client.noBookings")}</p>
              ) : (
                <>
                  <BookingList title={t("client.comingUp")} bookings={upcoming} timeZone={timeZone} testOnRecord={Boolean(client.patchTestAt)} />
                  <BookingList title={t("client.history")} bookings={past} timeZone={timeZone} testOnRecord={Boolean(client.patchTestAt)} />
                </>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
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

function BookingList({
  title,
  bookings,
  timeZone,
  testOnRecord,
}: {
  title: string;
  bookings: Booking[];
  timeZone: string;
  /** A test is recorded on the client, so a booking's flag is answered. */
  testOnRecord: boolean;
}) {
  const { t, lang } = useT();
  if (bookings.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="divide-y rounded-md border">
        {bookings.map((b) => {
          const status = appointmentStatus(b.status);
          const textFailed = Boolean(b.confirmationError && !b.confirmationSentAt);
          const needsTest = b.patchTestRequired && !testOnRecord;
          return (
            <li key={b.id} className="space-y-1 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{when(b.startsAt, timeZone, lang)}</span>
                <span className={cn(STATUS_BADGE, status.className)}>
                  {(STATUS_KEYS as readonly string[]).includes(b.status) ? t(`status.${b.status as (typeof STATUS_KEYS)[number]}`) : status.label}
                </span>
              </div>
              <p className="text-muted-foreground">
                {b.serviceText} · {b.stylistName}
                {b.amountMinor !== null && <> · {formatMoney(b.amountMinor)}</>}
              </p>
              {(needsTest || textFailed) && (
                <div className="flex flex-wrap gap-1.5">
                  {needsTest && (
                    <span className={cn(STATUS_BADGE, PATCH_TEST_BADGE)}>{t("client.testNeeded")}</span>
                  )}
                  {textFailed && (
                    <span className={cn(STATUS_BADGE, SMS_STATUS.failed.className)}>
                      {t("client.textFailed")}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
