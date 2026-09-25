"use client";

/**
 * Change a booking at the desk, and confirm a booking dragged on the diary.
 *
 * Editing reuses the details screen new bookings are made on, filled in from
 * the booking, so the two cannot drift apart in what they check or warn
 * about. The booking keeps its number whatever changes.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { salonDate, wallTimeToUtc } from "@/lib/calendar-layout";
import { splitServiceText, type SalonService } from "@/lib/salon-config";
import { ClientPicker, type ClientRow } from "./client-picker";
import { BookingDetails, type BookingDraft } from "./booking-details";
import type { CalendarAppointment, DiaryBlock } from "./day-grid";

/** "HH:MM" of an instant on the salon's clock. */
function clockTime(at: Date, timeZone: string): string {
  return at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

function describe(at: Date, timeZone: string): string {
  return at.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

/** Whether the booking can still be moved: booked and not yet started. */
export function isMovable(a: CalendarAppointment): boolean {
  return a.status === "booked" && new Date(a.startsAt) >= new Date();
}

function clientOf(a: CalendarAppointment): ClientRow {
  return {
    id: a.lead.id,
    name: a.lead.name,
    firstName: a.lead.firstName,
    lastName: a.lead.lastName,
    phone: a.lead.phone,
    email: a.lead.email,
    notes: a.lead.notes,
    lastVisit: null,
    // Only used to decide the skin-test warning; the booking already knows.
    visits: a.clientType === "returning" ? 1 : 0,
    nextBooking: null,
  };
}

async function saveChanges(
  id: string,
  body: Record<string, unknown>
): Promise<{ ok: true; textError: string | null } | { ok: false; error: string }> {
  try {
    const res = await apiFetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "Could not save the changes." };
    const textError =
      body.notifyClient && !data.textSent ? (data.textError ?? "The text did not send.") : null;
    return { ok: true, textError };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

interface EditBookingDialogProps {
  appointment: CalendarAppointment | null;
  services: SalonService[];
  stylists: string[];
  timeZone: string;
  dayAppointments: CalendarAppointment[];
  dayBlocks: DiaryBlock[];
  onClose: () => void;
  onSaved: () => void;
}

export function EditBookingDialog(props: EditBookingDialogProps) {
  if (!props.appointment) return <Dialog open={false} onOpenChange={() => props.onClose()} />;
  // Keyed by booking, so opening another one starts from its own details
  // rather than whatever was half-changed on the last.
  return <EditBooking key={props.appointment.id} {...props} appointment={props.appointment} />;
}

function EditBooking({
  appointment: a,
  services,
  stylists,
  timeZone,
  dayAppointments,
  dayBlocks,
  onClose,
  onSaved,
}: EditBookingDialogProps & { appointment: CalendarAppointment }) {
  const [client, setClient] = useState<ClientRow>(() => clientOf(a));
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textProblem, setTextProblem] = useState<string | null>(null);

  const start = new Date(a.startsAt);
  const locked = !isMovable(a);
  const initial = {
    date: salonDate(start, timeZone),
    time: clockTime(start, timeZone),
    stylistName: a.stylistName,
    serviceNames: splitServiceText(a.serviceText),
    minutes: a.durationMinutes,
    notes: a.notes,
  };

  const submit = async (draft: BookingDraft) => {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      serviceNames: draft.serviceNames,
      notes: draft.notes,
      notifyClient: draft.notifyClient,
    };
    if (!locked) {
      body.startsAt = wallTimeToUtc(draft.date, draft.time, timeZone).toISOString();
      body.stylistName = draft.stylistName;
      body.durationMinutes = draft.durationMinutes;
    }
    if (client.id !== a.lead.id) body.leadId = client.id;

    const result = await saveChanges(a.id, body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
    if (result.textError) setTextProblem(result.textError);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={picking ? "sm:max-w-3xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>
            {picking
              ? "Who is this booking for?"
              : `Change booking${a.bookingNumber !== null ? ` #${a.bookingNumber}` : ""}`}
          </DialogTitle>
        </DialogHeader>

        {textProblem ? (
          <div className="grid gap-4">
            <p className="text-sm">
              Saved. The text to the client could not be sent: {textProblem}
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : picking ? (
          <ClientPicker
            timeZone={timeZone}
            onPick={(c) => {
              setClient(c);
              setPicking(false);
            }}
          />
        ) : (
          <BookingDetails
            key={a.id}
            client={client}
            services={services}
            stylists={stylists}
            timeZone={timeZone}
            dayAppointments={dayAppointments}
            dayBlocks={dayBlocks}
            dayShown={initial.date}
            initial={initial}
            editing={{ appointmentId: a.id, lockWhen: locked }}
            saving={saving}
            error={error}
            onBack={() => setPicking(true)}
            onCancel={onClose}
            onSubmit={submit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Drag to move
// ---------------------------------------------------------------------------

export interface PendingMove {
  appointment: CalendarAppointment;
  stylistName: string;
  date: string;
  time: string;
}

interface MoveConfirmDialogProps {
  move: PendingMove | null;
  timeZone: string;
  onClose: () => void;
  onMoved: () => void;
}

/**
 * Nothing moves until this is confirmed, so a slip of the mouse cannot move a
 * client's appointment.
 */
export function MoveConfirmDialog(props: MoveConfirmDialogProps) {
  if (!props.move) return <Dialog open={false} onOpenChange={() => props.onClose()} />;
  const m = props.move;
  return (
    <MoveConfirm
      key={`${m.appointment.id}-${m.stylistName}-${m.date}-${m.time}`}
      {...props}
      move={m}
    />
  );
}

function MoveConfirm({
  move,
  timeZone,
  onClose,
  onMoved,
}: MoveConfirmDialogProps & { move: PendingMove }) {
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textProblem, setTextProblem] = useState<string | null>(null);

  const a = move.appointment;
  const to = wallTimeToUtc(move.date, move.time, timeZone);
  const who = a.lead.name ?? "this client";

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const result = await saveChanges(a.id, {
      startsAt: to.toISOString(),
      stylistName: move.stylistName,
      notifyClient: Boolean(a.lead.phone) && notify,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onMoved();
    if (result.textError) setTextProblem(result.textError);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move this booking?</DialogTitle>
        </DialogHeader>
        {textProblem ? (
          <>
            <p className="text-sm">Moved. The text to the client could not be sent: {textProblem}</p>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm">
              Move <span className="font-medium">{who}</span>
              {a.bookingNumber !== null && ` (#${a.bookingNumber})`} from{" "}
              {describe(new Date(a.startsAt), timeZone)} with {a.stylistName} to{" "}
              <span className="font-medium">
                {describe(to, timeZone)} with {move.stylistName}
              </span>
              ?
            </p>
            {a.lead.phone && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="h-4 w-4 accent-foreground"
                />
                Text the client about the change
              </label>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={confirm} disabled={saving}>
                {saving ? "Moving…" : "Move"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
