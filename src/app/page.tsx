"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/dashboard/stat-card";
import { RecentCalls } from "@/components/dashboard/recent-calls";
import { CallbacksList } from "@/components/dashboard/callbacks-list";
import {
  Phone,
  Users,
  Clock,
  PhoneIncoming,
  PieChart as PieChartIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { plural } from "@/lib/plural";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_SERIES,
  CHART_TICK,
  CHART_TOOLTIP,
  SENTIMENT_COLORS,
} from "@/lib/chart-theme";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";

interface Stats {
  totalCalls: number;
  callsToday: number;
  callsThisWeek: number;
  callsThisMonth: number;
  totalLeads: number;
  newLeads: number;
  pendingCallbacks: number;
  avgDuration: number;
  recentCalls: Array<{
    id: string;
    phoneNumber: string;
    status: string;
    duration: number;
    summary: string | null;
    sentiment: string | null;
    createdAt: string;
    lead: { name: string | null; company: string | null } | null;
  }>;
  sentimentDistribution: Array<{ sentiment: string; count: number }>;
  callVolume: Array<{ day: string; count: number }>;
}

interface Callback {
  id: string;
  assignedTo: string;
  scheduledAt: string;
  status: string;
  notes: string | null;
  lead: { name: string | null; phone: string; company: string | null };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, callbacksRes] = await Promise.all([
          apiFetch("/api/stats"),
          apiFetch("/api/callbacks?status=pending"),
        ]);
        const statsData = await statsRes.json();
        const callbacksData = await callbacksRes.json();
        setStats(statsData);
        setCallbacks(callbacksData.callbacks || []);
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your AI call assistant activity"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Calls today"
          value={stats?.callsToday || 0}
          subtitle={`${plural(stats?.callsThisWeek || 0, "call")} this week`}
          icon={PhoneIncoming}
        />
        <StatCard
          title="Total calls"
          value={stats?.totalCalls || 0}
          subtitle={`${plural(stats?.callsThisMonth || 0, "call")} this month`}
          icon={Phone}
        />
        <StatCard
          title="Leads captured"
          value={stats?.totalLeads || 0}
          subtitle={`${plural(stats?.newLeads || 0, "new lead")} this week`}
          icon={Users}
          // Only call it growth when something actually grew — a green "0 new
          // leads this week" is worse than no colour at all.
          trend={(stats?.newLeads || 0) > 0 ? "up" : "neutral"}
        />
        <StatCard
          title="Avg duration"
          value={formatDuration(stats?.avgDuration || 0)}
          subtitle={`${plural(
            stats?.pendingCallbacks || 0,
            "callback",
          )} pending`}
          icon={Clock}
        />
      </div>

      {/* Charts Row: Sentiment + Call Volume */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sentiment Distribution */}
        <Card className="gap-0">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium">
              Sentiment distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {stats?.sentimentDistribution &&
            stats.sentimentDistribution.length > 0 ? (
              <>
                {/*
                  Labels used to be drawn onto the slices. They needed a font
                  size, the only way to set one was `style` on the <Pie>, and an
                  inline style beats a presentation attribute — so its `fill`
                  silently overrode every <Cell>, painting a "positive" slice
                  the same grey as a "negative" one. A legend needs no styling
                  on the chart at all, and reads better than text wedged against
                  a donut.
                */}
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        isAnimationActive={false}
                        data={stats.sentimentDistribution}
                        dataKey="count"
                        nameKey="sentiment"
                        cx="50%"
                        cy="50%"
                        innerRadius={44}
                        outerRadius={66}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {stats.sentimentDistribution.map((entry) => (
                          <Cell
                            key={entry.sentiment}
                            fill={
                              SENTIMENT_COLORS[entry.sentiment] || CHART_AXIS
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={CHART_TOOLTIP} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-3">
                  {stats.sentimentDistribution.map((entry) => (
                    <li
                      key={entry.sentiment}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            SENTIMENT_COLORS[entry.sentiment] || CHART_AXIS,
                        }}
                      />
                      <span className="text-muted-foreground capitalize">
                        {entry.sentiment}
                      </span>
                      <span className="text-foreground tabular-nums font-medium">
                        {entry.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState
                icon={PieChartIcon}
                title="No sentiment yet"
                hint="Once calls come through, this shows how callers sounded — positive, neutral or negative."
                className="h-52 py-0"
              />
            )}
          </CardContent>
        </Card>

        {/* Call Volume (last 30 days) */}
        <Card className="lg:col-span-2 gap-0">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium">
              Call volume
              <span className="text-muted-foreground font-normal ml-2">
                last 30 days
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {stats?.callVolume && stats.callVolume.length > 0 ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={stats.callVolume}
                    margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART_GRID}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(d) => {
                        try {
                          return format(new Date(d), "MMM d");
                        } catch {
                          return d;
                        }
                      }}
                      tick={CHART_TICK}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={CHART_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP}
                      cursor={{ stroke: CHART_GRID }}
                      labelFormatter={(d) => {
                        try {
                          return format(new Date(d), "MMM d, yyyy");
                        } catch {
                          return d;
                        }
                      }}
                      formatter={(value) => [value, "Calls"]}
                    />
                    <Line
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="count"
                      stroke={CHART_SERIES[0]}
                      strokeWidth={2}
                      // A single day of data draws no line at all — a lone
                      // point needs a dot or the chart looks empty, which is
                      // exactly how it looked.
                      dot={stats.callVolume.length === 1}
                      activeDot={{ r: 4, fill: CHART_SERIES[0] }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={Phone}
                title="No calls yet"
                hint="Daily call counts appear here as soon as your assistant starts taking calls."
                className="h-52 py-0"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Calls + Callbacks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentCalls calls={stats?.recentCalls || []} />
        </div>
        <div>
          <CallbacksList callbacks={callbacks} />
        </div>
      </div>
    </div>
  );
}
