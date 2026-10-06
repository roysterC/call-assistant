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
import { plural } from "@/lib/plural";
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

export function SalonOverview() {
  const router = useRouter();
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
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone: data?.timeZone,
      hour: "2-digit",
      minute: "2-digit",
    });
    return (iso: string) => f.format(new Date(iso));
  }, [data?.timeZone]);

  const appointmentColumns = useMemo<ColumnDef<Appointment>[]>(
    () => [
      {
        id: "time",
        header: "Time",
        enableSorting: false,
        meta: { className: "whitespace-nowrap tabular-nums" },
        cell: ({ row: { original: a } }) => (
          <>
            {time(a.startsAt)}
            <SubText>until {time(a.endsAt)}</SubText>
          </>
        ),
      },
      {
        id: "client",
        header: "Client",
        enableSorting: false,
        cell: ({ row: { original: a } }) => <PersonCell name={a.lead.name} detail={a.serviceText} />,
      },
      {
        id: "stylist",
        header: "Stylist",
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap sm:table-cell", headerClassName: "hidden sm:table-cell" },
        accessorKey: "stylistName",
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row: { original: a } }) => {
          const st = appointmentStatus(a.status);
          return (
            <span className="flex flex-wrap gap-1">
              <span className={cn(STATUS_BADGE, st.className)}>{st.label}</span>
              {a.patchTestRequired && <span className={cn(STATUS_BADGE, PATCH_TEST_BADGE)}>Patch test</span>}
            </span>
          );
        },
      },
      {
        id: "source",
        header: "Booked by",
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap md:table-cell", headerClassName: "hidden md:table-cell" },
        cell: ({ row: { original: a } }) =>
          a.source === "voice" ? <Pill>Receptionist</Pill> : <span className="text-muted-foreground">The desk</span>,
      },
    ],
    [time]
  );

  const callColumns = useMemo<ColumnDef<RecentCall>[]>(
    () => [
      {
        id: "caller",
        header: "Caller",
        enableSorting: false,
        cell: ({ row: { original: c } }) => (
          <PersonCell name={c.lead?.name || "Unknown caller"} detail={c.phoneNumber} />
        ),
      },
      {
        id: "outcome",
        header: "Outcome",
        enableSorting: false,
        cell: ({ row: { original: c } }) =>
          c.outcomes.length ? (
            <span className="flex flex-wrap gap-1">
              {c.outcomes.map((o) => {
                const style = OUTCOME_STYLE[o] ?? { label: o, className: "" };
                return (
                  <span key={o} className={cn(STATUS_BADGE, style.className)}>
                    {style.label}
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
        header: "When",
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap text-muted-foreground sm:table-cell", headerClassName: "hidden sm:table-cell" },
        cell: ({ row: { original: c } }) => formatDistanceToNowStrict(new Date(c.createdAt), { addSuffix: true }),
      },
    ],
    []
  );

  const callbackColumns = useMemo<ColumnDef<Callback>[]>(
    () => [
      {
        id: "customer",
        header: "Customer",
        enableSorting: false,
        cell: ({ row: { original: cb } }) => (
          <PersonCell name={cb.lead.name || "Unknown"} detail={cb.notes || cb.lead.phone} />
        ),
      },
      {
        id: "called",
        header: "Called",
        enableSorting: false,
        meta: { className: "hidden whitespace-nowrap text-muted-foreground sm:table-cell", headerClassName: "hidden sm:table-cell" },
        cell: ({ row: { original: cb } }) => (
          <>
            {format(new Date(cb.createdAt), "d MMM, HH:mm")}
            {cb.assignedTo && <SubText>For {cb.assignedTo}</SubText>}
          </>
        ),
      },
    ],
    []
  );

  if (failed) {
    return (
      <p role="alert" className="text-sm text-red-600">
        The dashboard couldn&apos;t be loaded. Refresh to try again.
      </p>
    );
  }

  const appointments = data?.appointments ?? [];
  const nowIso = new Date().toISOString();
  const next = appointments.find((a) => a.status === "booked" && a.startsAt > nowIso);
  const todaySubtitle = !data
    ? ""
    : appointments.length === 0
      ? "Nothing booked today"
      : next
        ? `Next at ${time(next.startsAt)}${next.lead.name ? ` · ${next.lead.name}` : ""}`
        : "No more today";

  const pending = data?.callbacks.pending ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard
          title="Today's appointments"
          value={loading ? "–" : appointments.length}
          subtitle={todaySubtitle}
          icon={CalendarDays}
          href="/calendar"
        />
        <StatCard
          title="Taken this week"
          value={loading ? "–" : formatMoney(data?.takings.takenMinor ?? 0)}
          subtitle={data ? `${formatMoney(data.takings.expectedMinor)} still in the diary` : ""}
          icon={Coins}
          href="/sales"
        />
        <StatCard
          title="Booked by the receptionist"
          value={loading ? "–" : (data?.bookings.byAssistant ?? 0)}
          subtitle={data ? `of ${plural(data.bookings.thisMonth, "booking")} made this month` : ""}
          icon={Sparkles}
          accent={(data?.bookings.byAssistant ?? 0) > 0}
        />
        <StatCard
          title="Callbacks waiting"
          value={loading ? "–" : pending}
          subtitle={
            !data
              ? ""
              : pending === 0
                ? "All caught up"
                : data.callbacks.oldestAt
                  ? `Oldest ${formatDistanceToNowStrict(new Date(data.callbacks.oldestAt), { addSuffix: true })}`
                  : ""
          }
          icon={CalendarClock}
          trend={pending > 0 ? "down" : "neutral"}
          href="/callbacks"
        />
      </div>

      <Section id="dash-today" title="Today" icon={CalendarDays} href="/calendar" linkLabel="Open the diary">
        <DataTable
          columns={appointmentColumns}
          data={appointments}
          getRowId={(a) => a.id}
          onRowClick={() => router.push("/calendar")}
          rowLabel={(a) => `${time(a.startsAt)} ${a.lead.name ?? "appointment"} in the diary`}
          loading={loading}
          pageSize={10}
          noun="appointments"
          empty={
            <EmptyState
              icon={CalendarDays}
              title="Nothing in the diary today"
              hint="Bookings for today, from the receptionist or the desk, appear here."
            />
          }
        />
      </Section>

      {/* Side by side only where both tables fit; stacked, each gets the full width. */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <Section
          id="dash-calls"
          title="Recent calls"
          icon={PhoneIncoming}
          href="/calls"
          linkLabel={data ? `${plural(data.calls.today, "call")} today` : "Call History"}
        >
          <DataTable
            columns={callColumns}
            data={data?.calls.recent ?? []}
            getRowId={(c) => c.id}
            onRowClick={() => router.push("/calls")}
            rowLabel={(c) => `${c.lead?.name || c.phoneNumber} in Call History`}
            loading={loading}
            noun="calls"
            empty={
              <EmptyState
                icon={Phone}
                title="No calls yet"
                hint="Calls appear here as soon as your receptionist starts answering."
              />
            }
          />
        </Section>

        <Section
          id="dash-callbacks"
          title="Callbacks waiting"
          icon={CalendarClock}
          href="/callbacks"
          linkLabel={pending > callbacks.length ? `All ${pending}` : "Callbacks"}
        >
          <DataTable
            columns={callbackColumns}
            data={callbacks}
            getRowId={(cb) => cb.id}
            onRowClick={() => router.push("/callbacks")}
            rowLabel={(cb) => `${cb.lead.name || "callback"} in Callbacks`}
            loading={loading}
            noun="callbacks"
            empty={<EmptyState icon={CalendarClock} title="All caught up" hint="Nobody is waiting for a call back." />}
          />
        </Section>
      </div>
    </div>
  );
}
