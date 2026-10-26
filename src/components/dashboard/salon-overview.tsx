"use client";

/**
 * A salon's dashboard: today's diary, the week's takings, what the receptionist
 * booked, and who is waiting for a call back. Each headline number opens the
 * page behind it; the tables underneath are the same ones as those pages, cut
 * down to what matters this morning.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNowStrict } from "date-fns";
import { CalendarDays, CalendarClock, Coins, Phone, PhoneIncoming, Sparkles } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, PersonCell, Pill, SubText, type ColumnDef } from "@/components/ui/data-table";
import { apiFetch } from "@/lib/api-fetch";
import { formatMoney } from "@/lib/money";
import { useT } from "@/components/providers/language-provider";
import { DATE_FNS_LOCALE } from "@/lib/i18n";
import { appointmentStatus, OUTCOME_STYLE, PATCH_TEST_BADGE, STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  serviceText: string;
  stylistName: string;
  status: string;
  source: string;
  patchTestRequired: boolean;
  lead: { name: string | null; phone: string | null };
}

interface RecentCall {
  id: string;
  phoneNumber: string;
  duration: number;
  outcomes: string[];
  createdAt: string;
  lead: { name: string | null } | null;
}

interface Overview {
  today: string;
  timeZone: string;
  appointments: Appointment[];
  takings: { takenMinor: number; expectedMinor: number };
  bookings: { thisMonth: number; byAssistant: number };
  callbacks: { pending: number; oldestAt: string | null };
  calls: { today: number; thisWeek: number; recent: RecentCall[] };
}

interface Callback {
  id: string;
  assignedTo: string;
  createdAt: string;
  notes: string | null;
  lead: { name: string | null; phone: string | null };
}

/** A heading over a table, with a link to the full page. */
function Section({
  id,
  title,
  icon: Icon,
  href,
  linkLabel,
  className,
  children,
}: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  linkLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 space-y-3", className)} aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="flex items-center gap-2 font-heading text-base font-semibold">
          <Icon className="h-5 w-5" />
          {title}
        </h2>
        <Link href={href} className="text-sm font-medium text-primary hover:underline">
          {linkLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}

const CALL_OUTCOMES = ["booked", "rescheduled", "cancelled", "message", "enquiry", "hung_up"] as const;
const APPOINTMENT_STATUSES = ["booked", "completed", "cancelled", "no_show"] as const;
const isOneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

export function SalonOverview() {
  const router = useRouter();
  const { t, lang, locale } = useT();
  const dateLocale = DATE_FNS_LOCALE[lang];
  const [data, setData] = useState<Overview | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/dashboard").then((r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<Overview>;
      }),
      apiFetch("/api/callbacks?status=pending")
        .then((r) => (r.ok ? r.json() : { callbacks: [] }))
        .catch(() => ({ callbacks: [] })),
    ])
      .then(([d, c]) => {
        setData(d);
        setCallbacks((c.callbacks ?? []).slice(0, 5));
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // The salon's clock, not the browser's: the diary is kept in the salon's time.
  const time = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, {
      timeZone: data?.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return (iso: string) => f.format(new Date(iso));
  }, [data?.timeZone, locale]);

  const appointmentColumns = useMemo<ColumnDef<Appointment>[]>(
    () => [
      {
        id: "time",
        header: t("dash.time"),
        enableSorting: false,
        meta: { className: "whitespace-nowrap tabular-nums" },
        cell: ({ row: { original: a } }) => (
          <>
            {time(a.startsAt)}
            <SubText>{t("dash.until", { time: time(a.endsAt) })}</SubText>
          </>
        ),
      },
      {
        id: "client",
        header: t("dash.client"),
        enableSorting: false,
        cell: ({ row: { original: a } }) => <PersonCell name={a.lead.name} detail={a.serviceText} />,
      },
      {
        id: "stylist",
        header: t("dash.stylist"),
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap sm:table-cell", headerClassName: "hidden sm:table-cell" },
        accessorKey: "stylistName",
      },
      {
        id: "status",
        header: t("dash.status"),
        enableSorting: false,
        cell: ({ row: { original: a } }) => {
          const st = appointmentStatus(a.status);
          return (
            <span className="flex flex-wrap gap-1">
              <span className={cn(STATUS_BADGE, st.className)}>
                {isOneOf(APPOINTMENT_STATUSES, a.status) ? t(`status.${a.status}`) : st.label}
              </span>
              {a.patchTestRequired && <span className={cn(STATUS_BADGE, PATCH_TEST_BADGE)}>{t("dash.patchTest")}</span>}
            </span>
          );
        },
      },
      {
        id: "source",
        header: t("dash.bookedBy"),
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap md:table-cell", headerClassName: "hidden md:table-cell" },
        cell: ({ row: { original: a } }) =>
          a.source === "voice" ? (
            <Pill>{t("dash.receptionist")}</Pill>
          ) : (
            <span className="text-muted-foreground">{t("dash.desk")}</span>
          ),
      },
    ],
    [time, t]
  );

  const callColumns = useMemo<ColumnDef<RecentCall>[]>(
    () => [
      {
        id: "caller",
        header: t("dash.caller"),
        enableSorting: false,
        cell: ({ row: { original: c } }) => (
          <PersonCell name={c.lead?.name || t("dash.unknownCaller")} detail={c.phoneNumber} />
        ),
      },
      {
        id: "outcome",
        header: t("dash.outcome"),
        enableSorting: false,
        cell: ({ row: { original: c } }) =>
          c.outcomes.length ? (
            <span className="flex flex-wrap gap-1">
              {c.outcomes.map((o) => {
                const style = OUTCOME_STYLE[o] ?? { label: o, className: "" };
                return (
                  <span key={o} className={cn(STATUS_BADGE, style.className)}>
                    {isOneOf(CALL_OUTCOMES, o) ? t(`outcome.${o}`) : style.label}
                  </span>
                );
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "when",
        header: t("dash.when"),
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap text-muted-foreground sm:table-cell", headerClassName: "hidden sm:table-cell" },
        cell: ({ row: { original: c } }) =>
          formatDistanceToNowStrict(new Date(c.createdAt), { addSuffix: true, locale: dateLocale }),
      },
    ],
    [t, dateLocale]
  );

  const callbackColumns = useMemo<ColumnDef<Callback>[]>(
    () => [
      {
        id: "customer",
        header: t("dash.customer"),
        enableSorting: false,
        cell: ({ row: { original: cb } }) => (
          <PersonCell name={cb.lead.name || t("dash.unknown")} detail={cb.notes || cb.lead.phone} />
        ),
      },
      {
        id: "called",
        header: t("dash.called"),
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap text-muted-foreground sm:table-cell", headerClassName: "hidden sm:table-cell" },
        cell: ({ row: { original: cb } }) => (
          <>
            {format(new Date(cb.createdAt), "d MMM, HH:mm", { locale: dateLocale })}
            {cb.assignedTo && <SubText>{t("dash.for", { name: cb.assignedTo })}</SubText>}
          </>
        ),
      },
    ],
    [t, dateLocale]
  );

  if (failed) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {t("dash.loadFailed")}
      </p>
    );
  }

  const appointments = data?.appointments ?? [];
  const nowIso = new Date().toISOString();
  const next = appointments.find((a) => a.status === "booked" && a.startsAt > nowIso);
  const todaySubtitle = !data
    ? ""
    : appointments.length === 0
      ? t("dash.nothingToday")
      : next
        ? `${t("dash.nextAt", { time: time(next.startsAt) })}${next.lead.name ? ` · ${next.lead.name}` : ""}`
        : t("dash.noMoreToday");

  const pending = data?.callbacks.pending ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard
          title={t("dash.todaysAppointments")}
          value={loading ? "–" : appointments.length}
          subtitle={todaySubtitle}
          icon={CalendarDays}
          href="/calendar"
        />
        <StatCard
          title={t("dash.takenThisWeek")}
          value={loading ? "–" : formatMoney(data?.takings.takenMinor ?? 0)}
          subtitle={data ? t("dash.stillInDiary", { amount: formatMoney(data.takings.expectedMinor) }) : ""}
          icon={Coins}
          href="/sales"
        />
        <StatCard
          title={t("dash.bookedByReceptionist")}
          value={loading ? "–" : (data?.bookings.byAssistant ?? 0)}
          subtitle={
            data
              ? t(data.bookings.thisMonth === 1 ? "dash.ofBookingsOne" : "dash.ofBookingsMany", { n: data.bookings.thisMonth })
              : ""
          }
          icon={Sparkles}
          accent={(data?.bookings.byAssistant ?? 0) > 0}
        />
        <StatCard
          title={t("dash.callbacksWaiting")}
          value={loading ? "–" : pending}
          subtitle={
            !data
              ? ""
              : pending === 0
                ? t("dash.allCaughtUp")
                : data.callbacks.oldestAt
                  ? t("dash.oldest", {
                      ago: formatDistanceToNowStrict(new Date(data.callbacks.oldestAt), { addSuffix: true, locale: dateLocale }),
                    })
                  : ""
          }
          icon={CalendarClock}
          trend={pending > 0 ? "down" : "neutral"}
          href="/callbacks"
        />
      </div>

      <Section id="dash-today" title={t("dash.today")} icon={CalendarDays} href="/calendar" linkLabel={t("dash.openDiary")}>
        <DataTable
          columns={appointmentColumns}
          data={appointments}
          getRowId={(a) => a.id}
          onRowClick={() => router.push("/calendar")}
          rowLabel={(a) => t("dash.rowInDiary", { time: time(a.startsAt), name: a.lead.name ?? t("dash.appointment") })}
          loading={loading}
          pageSize={10}
          noun={t("dash.appointmentsNoun")}
          empty={
            <EmptyState
              icon={CalendarDays}
              title={t("dash.nothingInDiary")}
              hint={t("dash.nothingInDiaryHint")}
            />
          }
        />
      </Section>

      {/* Side by side only where both tables fit; stacked, each gets the full width. */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <Section
          id="dash-calls"
          title={t("dash.recentCalls")}
          icon={PhoneIncoming}
          href="/calls"
          linkLabel={
            data
              ? t(data.calls.today === 1 ? "dash.callsTodayOne" : "dash.callsTodayMany", { n: data.calls.today })
              : t("dash.callHistory")
          }
        >
          <DataTable
            columns={callColumns}
            data={data?.calls.recent ?? []}
            getRowId={(c) => c.id}
            onRowClick={() => router.push("/calls")}
            rowLabel={(c) => t("dash.rowInCalls", { name: c.lead?.name || c.phoneNumber })}
            loading={loading}
            noun={t("dash.callsNoun")}
            empty={
              <EmptyState
                icon={Phone}
                title={t("dash.noCalls")}
                hint={t("dash.noCallsHint")}
              />
            }
          />
        </Section>

        <Section
          id="dash-callbacks"
          title={t("dash.callbacksWaiting")}
          icon={CalendarClock}
          href="/callbacks"
          linkLabel={pending > callbacks.length ? t("dash.allN", { n: pending }) : t("dash.callbacks")}
        >
          <DataTable
            columns={callbackColumns}
            data={callbacks}
            getRowId={(cb) => cb.id}
            onRowClick={() => router.push("/callbacks")}
            rowLabel={(cb) => t("dash.rowInCallbacks", { name: cb.lead.name || t("dash.callback") })}
            loading={loading}
            noun={t("dash.callbacksNoun")}
            empty={<EmptyState icon={CalendarClock} title={t("dash.allCaughtUp")} hint={t("dash.nobodyWaiting")} />}
          />
        </Section>
      </div>
    </div>
  );
}
