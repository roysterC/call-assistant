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
  MessageSquare,
  Sparkles,
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
  lead: { name: string | null; phone: string | null; company: string | null };
}

/** Which products this organisation actually has. */
interface Features {
  voice: boolean;
  chatbot: boolean;
}

interface ChatTotals {
  conversations: number;
  leads: number;
  conversionRate: number;
  outOfHours: number;
  outOfHoursRate: number;
}

interface ChatDay {
  day: string;
  conversations: number;
  leads: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [chat, setChat] = useState<ChatTotals | null>(null);
  const [chatDaily, setChatDaily] = useState<ChatDay[]>([]);
  // null while loading. The sidebar has always respected these flags; this
  // page did not, so a client who bought only the widget opened the product on
  // seven voice panels reading zero and nothing at all about their chatbot.
  const [features, setFeatures] = useState<Features | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const settings = await apiFetch("/api/settings")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const flags: Features = {
          voice: !!settings?.settings?.voiceEnabled,
          chatbot: !!settings?.settings?.chatbotEnabled,
        };
        setFeatures(flags);

        // Only ask for what this organisation actually has. A chatbot-only
        // client should not be paying the latency of a call-stats query, and
        // a voice-only one has no analytics to fetch.
        const work: Promise<void>[] = [];

        if (flags.voice) {
          work.push(
            Promise.all([
              apiFetch("/api/stats").then((r) => r.json()),
              apiFetch("/api/callbacks?status=pending").then((r) => r.json()),
            ]).then(([s, c]) => {
              setStats(s);
              setCallbacks(c.callbacks || []);
            }),
          );
        } else {
          // Leads are counted for every channel, so the totals are still
          // wanted even when the call panels are not.
          work.push(
            apiFetch("/api/stats")
              .then((r) => r.json())
              .then(setStats),
          );
        }

        if (flags.chatbot) {
          work.push(
            apiFetch("/api/website-chat/analytics?days=30")
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                if (!d) return;
                setChat(d.totals);
                setChatDaily(d.daily || []);
              })
              .catch(() => {}),
          );
        }

        await Promise.allSettled(work);
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

  // Default to showing the voice dashboard if the flags could not be read, so
  // a transient settings failure degrades to the old behaviour rather than to
  // a blank page.
  const showVoice = features ? features.voice : true;
  const showChat = features ? features.chatbot : false;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          showVoice && showChat
            ? "Overview of your calls and website chats"
            : showVoice
              ? "Overview of your AI call assistant activity"
              : showChat
                ? "Overview of your website chat activity"
                : "Overview of your account"
        }
      />

      {/*
        Nothing switched on. Previously this rendered the full voice dashboard
        anyway — seven panels of zeroes about a product the account does not
        have — which is exactly what a newly created client saw.
      */}
      {!showVoice && !showChat && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Sparkles}
              title="Nothing switched on yet"
              hint="Your account is set up but no channels are active. Your account manager at Kikai enables these."
            />
          </CardContent>
        </Card>
      )}

      {/* Voice KPIs — only for accounts with the voice agent. */}
      {showVoice && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
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
      )}

      {/*
        Chat KPIs. "Leads captured" appears here only when voice is off, so an
        account with both does not get the same number twice in one screen.
      */}
      {showChat && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            title="Conversations"
            value={chat?.conversations ?? 0}
            subtitle="last 30 days"
            icon={MessageSquare}
          />
          {!showVoice && (
            <StatCard
              title="Leads captured"
              value={stats?.totalLeads || 0}
              subtitle={`${plural(stats?.newLeads || 0, "new lead")} this week`}
              icon={Users}
              trend={(stats?.newLeads || 0) > 0 ? "up" : "neutral"}
            />
          )}
          <StatCard
            title="Chats to leads"
            value={`${chat?.conversionRate ?? 0}%`}
            subtitle={`${plural(chat?.leads ?? 0, "lead")} from chat`}
            icon={Users}
            accent={(chat?.conversionRate ?? 0) > 0}
          />
          {/*
            The number the product is sold on: enquiries that arrived when
            nobody was there to take them.
          */}
          <StatCard
            title="Outside working hours"
            value={`${chat?.outOfHoursRate ?? 0}%`}
            subtitle={`${plural(chat?.outOfHours ?? 0, "conversation")} out of hours`}
            icon={Clock}
            accent={(chat?.outOfHoursRate ?? 0) > 0}
          />
        </div>
      )}

      {/* Chat activity over time, for accounts without the call charts. */}
      {showChat && (
        <Card className="gap-0">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium">
              Website chats
              <span className="text-muted-foreground font-normal ml-2">
                last 30 days
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {chatDaily.length > 0 ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chatDaily}
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
                          return format(new Date(d), "d MMM");
                        } catch {
                          return d;
                        }
                      }}
                      tick={CHART_TICK}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={CHART_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Line
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="conversations"
                      stroke={CHART_SERIES[0]}
                      strokeWidth={2}
                      dot={chatDaily.length === 1}
                      name="Conversations"
                    />
                    <Line
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="leads"
                      stroke={CHART_SERIES[1]}
                      strokeWidth={2}
                      dot={chatDaily.length === 1}
                      name="Leads"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="No chats yet"
                hint="Conversations appear here once the widget is live on your site."
                className="h-52 py-0"
              />
            )}
            {chatDaily.length > 0 && (
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
            )}
          </CardContent>
        </Card>
      )}

      {/* Charts Row: Sentiment + Call Volume — voice only. */}
      {showVoice && (
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
      )}

      {/* Recent calls and callbacks are both voice concepts. */}
      {showVoice && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RecentCalls calls={stats?.recentCalls || []} />
          </div>
          <div>
            <CallbacksList callbacks={callbacks} />
          </div>
        </div>
      )}
    </div>
  );
}
