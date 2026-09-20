"use client";

/**
 * Take a booking at the desk.
 *
 * The service list drives the duration, exactly as it does on the phone, so a
 * three-hour balayage blocks three hours whichever door the booking came in
 * through. The duration stays editable because the person at the desk can see
 * the client's hair and the catalogue cannot.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { wallTimeToUtc } from "@/lib/calendar-layout";

export interface BookingSlot {
  stylistName: string;
  /** "HH:MM" in the salon's own clock. */
  time: string;
  /** "YYYY-MM-DD". */
  date: string;
}

export interface ServiceOption {
  name: string;
  durationMinutes: number;
  requiresPatchTest: boolean;
  priceMinor?: number | null;
}

interface NewBookingDialogProps {
  slot: BookingSlot | null;
  services: ServiceOption[];
  /** Salon zone, so the chosen wall-clock time is sent as the right instant. */
  timeZone: string;
  onClose: () => void;
  onBooked: () => void;
}

export function NewBookingDialog({
  slot,
  services,
  timeZone,
  onClose,
  onBooked,
}: NewBookingDialogProps) {
  const [service, setService] = useState("");
  const [duration, setDuration] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientType, setClientType] = useState("unknown");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per slot, so yesterday's half-filled form never rides along into a
  // new booking and books the wrong client.
  useEffect(() => {
    if (!slot) return;
    setService("");
    setDuration("");
    setClientName("");
    setClientPhone("");
    setClientType("unknown");
    setNotes("");
    setError(null);
  }, [slot]);

  const chosen = services.find((s) => s.name === service);
  const effectiveDuration = duration || (chosen ? String(chosen.durationMinutes) : "");
  const patchTestWarning =
    Boolean(chosen?.requiresPatchTest) && clientType === "new";

  const submit = async () => {
    if (!slot || !service) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: wallTimeToUtc(slot.date, slot.time, timeZone).toISOString(),
          stylistName: slot.stylistName,
          serviceText: service,
          durationMinutes: Number(effectiveDuration) || undefined,
          clientName: clientName || undefined,
          clientPhone: clientPhone || undefined,
          clientType,
          notes: notes || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save that booking.");
        return;
      }
      onBooked();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(slot)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {slot ? `${slot.time} with ${slot.stylistName}` : "New booking"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label htmlFor="booking-service" className="text-xs text-muted-foreground">
              Service
            </label>
            <Select value={service} onValueChange={(v) => setService(v ?? "")}>
              <SelectTrigger id="booking-service">
                <SelectValue placeholder="Choose a service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name} — {s.durationMinutes} min
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="booking-duration" className="text-xs text-muted-foreground">
                Minutes
              </label>
              <Input
                id="booking-duration"
                inputMode="numeric"
                value={effectiveDuration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="45"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="booking-client-type" className="text-xs text-muted-foreground">
                Client
              </label>
              <Select value={clientType} onValueChange={(v) => setClientType(v ?? "unknown")}>
                <SelectTrigger id="booking-client-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Not sure</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="returning">Returning</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="booking-name" className="text-xs text-muted-foreground">
              Name
            </label>
            <Input
              id="booking-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Walk-in"
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="booking-phone" className="text-xs text-muted-foreground">
              Phone (optional)
            </label>
            <Input
              id="booking-phone"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="07700 900123"
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="booking-notes" className="text-xs text-muted-foreground">
              Notes
            </label>
            <Textarea
              id="booking-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {patchTestWarning && (
            <p className="flex gap-2 text-xs text-amber-400">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              New client having colour — needs a skin patch test 48 hours first.
            </p>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!service || saving}>
            {saving ? "Booking…" : "Book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
