"use client";

/**
 * The phone receptionist's figures: calls taken, the share that came while
 * the salon was closed, what it booked and what that is worth, when people
 * ring and what they ring about.
 */

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { PhoneIncoming } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { apiFetch } from "@/lib/api-fetch";
import { plural } from "@/lib/plural";
import { formatMoney } from "@/lib/money";
import { OUTCOME_STYLE } from "@/lib/status-styles";
import type { ReceptionistInsights as Insights } from "@/lib/receptionist-insights";
import { CHART_GRID, CHART_SERIES, CHART_TICK, CHART_TOOLTIP } from "@/lib/chart-theme";

const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const dayLabel = (d: string) => format(new Date(`${d}T12:00:00`), "d MMM");

export function ReceptionistInsights({ days }: { days: number }) {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const r = await apiFetch(`/api/insights/receptionist?days=${days}`);
      if (!r.ok) throw new Error();
      setData((await r.json()) as Insights);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) {
    return <p className="py-12 text-center text-muted-foreground">Couldn&apos;t load insights.</p>;
  }
  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }
  if (!data) return null;

  const t = data.totals;
  if (t.calls === 0 && t.bookings === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={PhoneIncoming}
            title="No calls in this period"
            hint="Everything the receptionist answers shows up here. Try a longer range if it went live recently."
          />
        </CardContent>
      </Card>
    );
  }

  const maxOutcome = Math.max(...data.outcomes.map((o) => o.count), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard
          title="Calls answered"
          value={String(t.calls)}
          subtitle={t.calls ? `${minutes(t.avgDurationSeconds)} on average` : undefined}
        />
        {/*
          The pitch: the calls nobody would have picked up. Unknowable without
          opening hours, and then it says so rather than showing a zero.
        */}
        <StatCard
          title="While you were closed"
          value={t.whileClosedRate === null ? "—" : `${t.whileClosedRate}%`}
          subtitle={
            t.whileClosed === null
              ? "Set your opening hours in Settings"
              : `${plural(t.whileClosed, "call")} outside opening hours`
          }
          accent={(t.whileClosed ?? 0) > 0}
        />
        <StatCard
          title="Bookings made"
          value={String(t.bookings)}
          subtitle={`${t.bookingRate}% of calls ended in a booking`}
          accent={t.bookings > 0}
        />
        <StatCard
          title="Value booked"
          value={formatMoney(t.bookedValueMinor)}
          subtitle={
            t.unpricedBookings
              ? `At list price · ${plural(t.unpricedBookings, "booking")} without a price`
              : "At list price"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calls and bookings over time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={dayLabel}
                  tick={CHART_TICK}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={(d) => dayLabel(String(d))} />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="calls"
                  stroke={CHART_SERIES[0]}
                  strokeWidth={2}
                  dot={data.daily.length === 1}
                  name="Calls"
                />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="bookings"
                  stroke={CHART_SERIES[1]}
                  strokeWidth={2}
                  dot={data.daily.length === 1}
                  name="Bookings"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {[
              { label: "Calls", colour: CHART_SERIES[0] },
              { label: "Bookings by the receptionist", colour: CHART_SERIES[1] },
            ].map((s) => (
              <li key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.colour }} />
                {s.label}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">When people call</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.hourly.map((h) => ({ ...h, label: String(h.hour).padStart(2, "0") }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={false} interval={2} />
                  <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={(h) => `${h}:00`} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="calls"
                    fill={CHART_SERIES[0]}
                    radius={[3, 3, 0, 0]}
                    name="Calls"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              By the hour the call came in, in the salon&apos;s time.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What callers wanted</CardTitle>
          </CardHeader>
          <CardContent>
            {data.outcomes.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No call outcomes recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {data.outcomes.map((o) => (
                  <div key={o.outcome} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-foreground/80">
                        {OUTCOME_STYLE[o.outcome]?.label ?? o.outcome}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{o.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, (o.count / maxOutcome) * 100)}%`,
                          backgroundColor: CHART_SERIES[0],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              A call can come to more than one thing.{" "}
              {plural(t.callbacks, "caller")} asked for a call back in this period.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
