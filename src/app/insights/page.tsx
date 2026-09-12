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

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-3xl font-bold mt-1 ${
            accent ? "text-emerald-500" : ""
          }`}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

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
          <CardContent className="py-12 text-center">
            <p className="font-medium">No conversations yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Once the widget is live on your site, everything it captures shows
              up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Conversations" value={String(t.conversations)} />
            <Stat
              label="Leads captured"
              value={String(t.leads)}
              hint={`${t.conversionRate}% of conversations`}
              accent
            />
            {/*
              The headline number for this product. The pitch is "you're losing
              the enquiries you can't get to" — this is the client checking that
              claim against their own traffic.
            */}
            <Stat
              label="Outside working hours"
              value={`${t.outOfHoursRate}%`}
              hint={`${t.outOfHours} conversations outside ${data.businessHours.startHour}:00–${data.businessHours.endHour}:00, Mon–Fri`}
              accent
            />
            <Stat
              label="Messages per conversation"
              value={String(t.avgMessagesPerConversation)}
              hint={`${t.messages} messages total`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
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
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">When enquiries arrive</CardTitle>
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
                <CardTitle className="text-lg">Where they came from</CardTitle>
              </CardHeader>
              <CardContent>
                {data.topReferrers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {data.topReferrers.map((r) => (
                      <div
                        key={r.referrer}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="truncate text-slate-300">
                          {r.referrer}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          {r.count}
                        </span>
                      </div>
                    ))}
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
