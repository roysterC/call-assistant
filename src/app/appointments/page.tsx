"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarCheck, TriangleAlert } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  appointmentStatus,
  PATCH_TEST_BADGE,
  SMS_STATUS,
  STATUS_BADGE,
} from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { useMe } from "@/components/providers/me-provider";

interface Appointment {
  id: string;
  serviceText: string;
  durationMinutes: number;
  stylistName: string;
  startsAt: string;
  endsAt: string;
  clientType: string;
  patchTestRequired: boolean;
  status: string;
  source: string;
  notes: string | null;
  confirmationSentAt: string | null;
  confirmationError: string | null;
  reminderSentAt: string | null;
  reminderError: string | null;
  googleEventId: string | null;
  lead: { name: string | null; phone: string | null };
}

const SCOPES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
];

/** "Today, 2pm" reads faster at nine in the morning than a date does. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const time = format(d, "h:mmaaa").replace(":00", "");
  if (isToday(d)) return `Today, ${time}`;
  if (isTomorrow(d)) return `Tomorrow, ${time}`;
  return `${format(d, "EEE d MMM")}, ${time}`;
}

function smsState(a: Appointment): keyof typeof SMS_STATUS {
  if (a.confirmationSentAt) return "sent";
  if (a.confirmationError) return "failed";
  return "pending";
}

export default function AppointmentsPage() {
  const me = useMe();
  // A stylist login changes only bookings in their own column.
  const canChange = (stylistName: string) =>
    !me?.stylist || stylistName.toLowerCase() === me.stylist.name.toLowerCase();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("upcoming");
  const [detail, setDetail] = useState<Appointment | null>(null);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/appointments?scope=${scope}&status=${scope === "all" ? "all" : "booked"}`
      );
      const data = await res.json();
      setAppointments(data.appointments ?? []);
    } catch (error) {
      console.error("Failed to fetch appointments:", error);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  async function updateStatus(id: string, status: string) {
    try {
      await apiFetch("/api/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setDetail(null);
      fetchAppointments();
    } catch (error) {
      console.error("Failed to update appointment:", error);
    }
  }

  const failedTexts = appointments.filter(
    (a) => a.confirmationError && !a.confirmationSentAt
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description="Bookings the receptionist has put in the diary"
      />

      {/* The diary itself lives in Google. Saying so stops anyone treating a
          status change here as a cancellation the stylist will see. */}
      {failedTexts > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          <TriangleAlert className="h-4 w-4 shrink-0 mt-px" />
          <span>
            {failedTexts} confirmation {failedTexts === 1 ? "text" : "texts"} did
            not send. Those clients have not been told anything in writing —
            worth a call.
          </span>
        </div>
      )}

      <div className="flex gap-1">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            onClick={() => setScope(s.value)}
            aria-pressed={scope === s.value}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              scope === s.value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Stylist</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Text</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : appointments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={CalendarCheck}
                      title={scope === "upcoming" ? "Nothing booked yet" : "No appointments"}
                      hint={
                        scope === "upcoming"
                          ? "Appointments the receptionist books will appear here."
                          : "Nothing matches this filter."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                appointments.map((a) => {
                  const status = appointmentStatus(a.status);
                  const sms = smsState(a);
                  return (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer"
                      onClick={() => setDetail(a)}
                    >
                      <TableCell className="whitespace-nowrap font-medium">
                        {whenLabel(a.startsAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span>{a.lead?.name ?? "—"}</span>
                          {a.clientType === "new" && (
                            <span className="text-[10px] text-muted-foreground">new</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {a.lead?.phone ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span>{a.serviceText}</span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {a.durationMinutes}m
                          </span>
                          {/* Never truncated: a missed patch test is a skin
                              reaction, not an inconvenience. */}
                          {a.patchTestRequired && (
                            <span className={cn(STATUS_BADGE, PATCH_TEST_BADGE)}>
                              Patch test
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{a.stylistName}</TableCell>
                      <TableCell>
                        <span className={cn(STATUS_BADGE, status.className)}>
                          {status.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn(STATUS_BADGE, SMS_STATUS[sms].className)}>
                          {SMS_STATUS[sms].label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {detail?.serviceText} — {detail?.lead?.name ?? "Unknown client"}
            </DialogTitle>
          </DialogHeader>

          {detail && (
            <div className="space-y-3 text-sm">
              <Row label="When">
                {whenLabel(detail.startsAt)} ({detail.durationMinutes} minutes)
              </Row>
              <Row label="Stylist">{detail.stylistName}</Row>
              <Row label="Phone">{detail.lead?.phone ?? "—"}</Row>
              <Row label="Client">
                {detail.clientType === "new" ? "New client" : detail.clientType === "returning" ? "Returning" : "Not known"}
              </Row>
              {detail.patchTestRequired && (
                <Row label="Patch test">
                  <span className={cn(STATUS_BADGE, PATCH_TEST_BADGE)}>
                    Required 48h before
                  </span>
                </Row>
              )}
              <Row label="Booked by">
                {detail.source === "voice" ? "Phone receptionist" : "Staff"}
              </Row>
              <Row label="Confirmation">
                {detail.confirmationSentAt
                  ? `Sent ${format(new Date(detail.confirmationSentAt), "d MMM, HH:mm")}`
                  : detail.confirmationError
                    ? <span className="text-red-400">{detail.confirmationError}</span>
                    : "Not sent"}
              </Row>
              <Row label="Reminder">
                {detail.reminderSentAt
                  ? `Sent ${format(new Date(detail.reminderSentAt), "d MMM, HH:mm")}`
                  : detail.reminderError
                    ? <span className="text-red-400">{detail.reminderError}</span>
                    : "Goes out the day before"}
              </Row>
              {detail.notes && <Row label="Notes">{detail.notes}</Row>}

              <p className="text-xs text-muted-foreground pt-1">
                The diary itself is in Google Calendar. Marking an appointment
                here records what happened; it does not remove the stylist&apos;s
                calendar entry.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {detail?.status === "booked" && canChange(detail.stylistName) && (
              <>
                <Button
                  variant="outline"
                  onClick={() => updateStatus(detail.id, "no_show")}
                >
                  No show
                </Button>
                <Button
                  variant="outline"
                  onClick={() => updateStatus(detail.id, "cancelled")}
                >
                  Cancelled
                </Button>
                <Button onClick={() => updateStatus(detail.id, "completed")}>
                  Completed
                </Button>
              </>
            )}
            {detail?.status !== "booked" && (
              <Button variant="outline" onClick={() => setDetail(null)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}
