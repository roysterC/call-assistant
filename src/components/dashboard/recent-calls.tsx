"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Clock, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Call {
  id: string;
  phoneNumber: string;
  status: string;
  duration: number;
  summary: string | null;
  sentiment: string | null;
  createdAt: string;
  lead: { name: string | null; company: string | null } | null;
}

export function RecentCalls({ calls }: { calls: Call[] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg text-white">Recent Calls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No calls yet. Calls will appear here once your AI assistant starts taking calls.
          </p>
        ) : (
          calls.map((call) => (
            <div
              key={call.id}
              className="flex items-start gap-4 p-3 rounded-xl border border-border/60 bg-white/[0.02] hover:bg-accent/50 transition-colors"
            >
              <div className="w-9 h-9 bg-blue-600/15 rounded-full flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-white">
                    {call.lead?.name || call.phoneNumber}
                  </span>
                  {call.lead?.company && (
                    <span className="text-xs text-muted-foreground">
                      {call.lead.company}
                    </span>
                  )}
                  <SentimentBadge sentiment={call.sentiment} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {call.summary || "No summary available"}
                </p>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(call.duration)}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {call.phoneNumber}
                  </span>
                  <span>
                    {formatDistanceToNow(new Date(call.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const variant =
    sentiment === "positive"
      ? "default"
      : sentiment === "negative"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="text-[10px] px-1.5 py-0">
      {sentiment}
    </Badge>
  );
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
