"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { plural } from "@/lib/plural";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageCircle, Link2 } from "lucide-react";
import {
  CHART_GRID,
  CHART_SERIES,
  CHART_TICK,
  CHART_TOOLTIP,
} from "@/lib/chart-theme";

interface Analytics {
  range: { days: number; timezone: string };
  businessHours: { startHour: number; endHour: number };
  totals: {
    conversations: number;
    leads: number;
    messages: number;
    conversionRate: number;
    avgMessagesPerConversation: number;
    outOfHours: number;
    outOfHoursRate: number;
  };
  daily: { day: string; conversations: number; leads: number }[];
  hourly: { hour: number; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  sites: { siteId: string; name: string }[];
}

const RANGES = [7, 30, 90];

export default function InsightsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [siteId, setSiteId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ days: String(days) });
      if (siteId) qs.set("siteId", siteId);
      const res = await apiFetch(`/api/website-chat/analytics?${qs}`);
      if (!res.ok) throw new Error("Failed");
      setData(await res.json());
    } catch (err) {
      console.error("Failed to load insights:", err);
    } finally {
      setLoading(false);
    }
  }, [days, siteId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-muted-foreground py-12 text-center">
        Couldn&apos;t load insights.
      </p>
    );
  }

  const t = data.totals;
  const empty = t.conversations === 0;

  // Every hour present, so a quiet 3am reads as a real zero rather than a gap
  // the chart silently closes up.
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}`,
    count: data.hourly.find((h) => h.hour === hour)?.count ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website chat insights"
        description={`Last ${data.range.days} days · times shown in ${data.range.timezone}`}
        actions={
          <>
            {data.sites.length > 1 && (
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
              >
                <option value="">All sites</option>
                {data.sites.map((s) => (
                  <option key={s.siteId} value={s.siteId}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex rounded-md border border-border overflow-hidden">
              {RANGES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  aria-pressed={days === d}
                  className={`px-3 h-9 text-sm transition-colors ${
                    days === d
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </>
        }
      />

      {empty ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={MessageCircle}
              title="No conversations in this period"
              hint="Once the widget is live on your site, everything it captures shows up here. Try a longer range if it went live recently."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard title="Conversations" value={String(t.conversations)} />
            <StatCard
              title="Leads captured"
              value={String(t.leads)}
              subtitle={`${t.conversionRate}% of conversations`}
              accent
            />
            {/*
              The headline number for this product. The pitch is "you're losing
              the enquiries you can't get to" — this is the client checking that
              claim against their own traffic.
            */}
            <StatCard
              title="Outside working hours"
              value={`${t.outOfHoursRate}%`}
              subtitle={`${plural(t.outOfHours, "conversation")} outside ${data.businessHours.startHour}:00–${data.businessHours.endHour}:00, Mon–Fri`}
              accent
            />
            <StatCard
              title="Messages per conversation"
              value={String(t.avgMessagesPerConversation)}
              subtitle={`${plural(t.messages, "message")} total`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Conversations and leads over time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.daily}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART_GRID}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      tick={CHART_TICK}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={CHART_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      allowDecimals={false}
                    />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Line
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="conversations"
                      stroke={CHART_SERIES[0]}
                      strokeWidth={2}
                      dot={false}
                      name="Conversations"
                    />
                    <Line
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="leads"
                      stroke={CHART_SERIES[1]}
                      strokeWidth={2}
                      dot={false}
                      name="Leads"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/*
                Two series and nothing saying which was which. The `name` props
                only reach the tooltip, so unless you hovered, the chart was two
                coloured lines and a guess. Same legend shape as the dashboard's
                sentiment card.
              */}
              <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-3">
                {[
                  { label: "Conversations", colour: CHART_SERIES[0] },
                  { label: "Leads", colour: CHART_SERIES[1] },
                ].map((s) => (
                  <li
                    key={s.label}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: s.colour }}
                    />
                    {s.label}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">When enquiries arrive</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourly}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART_GRID}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={CHART_TICK}
                        tickLine={false}
                        axisLine={false}
                        interval={2}
                      />
                      <YAxis
                        tick={CHART_TICK}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP}
                        labelFormatter={(h) => `${h}:00`}
                      />
                      <Bar
                        isAnimationActive={false}
                        dataKey="count"
                        fill={CHART_SERIES[0]}
                        radius={[3, 3, 0, 0]}
                        name="Conversations"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Bars outside {data.businessHours.startHour}:00–
                  {data.businessHours.endHour}:00 are enquiries that would
                  otherwise have waited until the next working day.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where they came from</CardTitle>
              </CardHeader>
              <CardContent className={data.topReferrers.length ? "" : "p-0"}>
                {data.topReferrers.length === 0 ? (
                  <EmptyState
                    icon={Link2}
                    title="No referrers recorded"
                    hint="Where visitors arrived from appears here once the widget sees traffic from more than one page."
                  />
                ) : (
                  /*
                    A bar behind each row. The list was names and counts in two
                    columns, which reads as a table of numbers to compare by
                    hand — the whole question being asked of it is "which of
                    these is bigger", and a length answers that without doing
                    arithmetic.
                  */
                  <div className="space-y-2">
                    {(() => {
                      const max = Math.max(
                        ...data.topReferrers.map((r) => r.count),
                        1
                      );
                      return data.topReferrers.map((r) => (
                        <div key={r.referrer} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="truncate text-foreground/80">
                              {r.referrer}
                            </span>
                            <span className="text-muted-foreground shrink-0 tabular-nums">
                              {r.count}
                            </span>
                          </div>
                          <div
                            className="h-1.5 rounded-full bg-muted overflow-hidden"
                            role="presentation"
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(2, (r.count / max) * 100)}%`,
                                backgroundColor: CHART_SERIES[0],
                              }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
