"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, User } from "lucide-react";
import { format } from "date-fns";

interface Callback {
  id: string;
  assignedTo: string;
  scheduledAt: string;
  status: string;
  notes: string | null;
  lead: { name: string | null; phone: string; company: string | null };
}

export function CallbacksList({ callbacks }: { callbacks: Callback[] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg text-white">Upcoming Callbacks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {callbacks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No pending callbacks
          </p>
        ) : (
          callbacks.map((cb) => (
            <div
              key={cb.id}
              className="flex items-center gap-4 p-3 rounded-xl border border-white/5 bg-white/[0.02]"
            >
              <div className="w-9 h-9 bg-amber-500/15 rounded-full flex items-center justify-center shrink-0">
                <CalendarClock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-white">
                    {cb.lead.name || cb.lead.phone}
                  </span>
                  <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                    {cb.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" />
                    {format(new Date(cb.scheduledAt), "MMM d, h:mm a")}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {cb.assignedTo}
                  </span>
                </div>
                {cb.notes && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {cb.notes}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
