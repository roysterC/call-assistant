"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/dashboard/stat-card";
import { SalonOverview } from "@/components/dashboard/salon-overview";
import { Users, Clock, MessageSquare, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { plural } from "@/lib/plural";
import { CHART_GRID, CHART_SERIES, CHART_TICK, CHART_TOOLTIP } from "@/lib/chart-theme";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";

/** Lead counts, for an organisation without the diary. */
interface Stats {
  totalLeads: number;
  newLeads: number;
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
  const [chat, setChat] = useState<ChatTotals | null>(null);
  const [chatDaily, setChatDaily] = useState<ChatDay[]>([]);
  // null while loading. The sidebar has always respected these flags; this
  // page did not, so a client who bought only the widget opened the product on
  // seven voice panels reading zero and nothing at all about their chatbot.
  const [features, setFeatures] = useState<Features | null>(null);

  const [loading, setLoading] = useState(true);
  // Who is looking decides whether the chatbot's figures are fetched, so the
  // page waits for the role before loading anything.
  const role = useMe()?.role ?? null;
  const isOwner = role === "admin" || role === "superAdmin";

  useEffect(() => {
    if (!role) return;
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

        // A salon's figures are fetched by SalonOverview itself. Without the
        // diary the page has only lead counts and the chatbot's figures.
        if (!flags.voice) {
          work.push(
            apiFetch("/api/stats")
              .then((r) => r.json())
              .then(setStats),
          );
        }

        // The chatbot's figures are the owner's (is it earning its keep?);
        // a member's dashboard leaves them out.
        if (flags.chatbot && isOwner) {
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
  }, [role, isOwner]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Default to showing the voice dashboard if the flags could not be read, so
  // a transient settings failure degrades to the old behaviour rather than to
  // a blank page.
  const showVoice = features ? features.voice : true;
  const showChat = features ? features.chatbot && isOwner : false;
  const chatbotOn = Boolean(features?.chatbot);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
      />

      {/*
        Nothing switched on. Previously this rendered the full voice dashboard
        anyway — seven panels of zeroes about a product the account does not
        have — which is exactly what a newly created client saw.
      */}
      {!showVoice && !chatbotOn && (
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

      {!showVoice && chatbotOn && !showChat && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Sparkles}
              title="Your chats are in Conversations"
              hint="The chatbot's figures are on the owner's dashboard."
            />
          </CardContent>
        </Card>
      )}

      {/* A salon's day: the diary, takings, the receptionist, callbacks. */}
      {showVoice && <SalonOverview />}

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

    </div>
  );
}
