/**
 * Cal.com v2 provider.
 *
 * Ported from the old `src/lib/calendar.ts` for organizations that already use
 * it. Two behaviours changed on the way across, both deliberate:
 *
 *  1. **No stub fallback.** The original returned `stubSlots()` — invented
 *     9-to-5 half-hour slots — whenever Cal.com errored. On a system that now
 *     confirms bookings out loud, silently substituting fiction for a failed
 *     API call is the worst thing this code could do. Errors propagate.
 *
 *  2. **No lying-true.** `bookCallback` used to return `success: true` when
 *     Cal.com failed, so the caller still persisted a local row rather than
 *     losing the lead. That is right for a callback and wrong for a confirmed
 *     appointment, so failure is now reported as failure and the caller
 *     decides what to keep.
 *
 * Cal.com docs: https://cal.com/docs/api-reference
 */

import type {
  AvailabilityQuery,
  BookingProvider,
  BookingWrite,
  BookingWriteResult,
  TimeSlot,
} from "../types";

const CAL_API_BASE = "https://api.cal.com/v2";

export interface CalComProviderConfig {
  apiKey: string;
  eventTypeId: string;
  timeZone: string;
  /** Cal.com bookings are fixed-length per event type. */
  defaultDurationMinutes?: number;
}

export function createCalComProvider(
  cfg: CalComProviderConfig
): BookingProvider {
  const slotMinutes = cfg.defaultDurationMinutes ?? 30;

  return {
    id: "calcom",

    capabilities: {
      readAvailability: true,
      createBooking: true,
      // One event type, no per-stylist resolution.
      perStaffAvailability: false,
      availabilityIsAdvisory: false,
    },

    async getAvailability(q: AvailabilityQuery): Promise<TimeSlot[]> {
      const startTime = new Date(`${q.date}T00:00:00.000Z`);
      const endTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000 - 1);

      const url = new URL(`${CAL_API_BASE}/slots`);
      url.searchParams.set("eventTypeId", cfg.eventTypeId);
      url.searchParams.set("startTime", startTime.toISOString());
      url.searchParams.set("endTime", endTime.toISOString());

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Cal.com /slots failed (${res.status}): ${text.slice(0, 300)}`
        );
      }

      const data = (await res.json()) as {
        data?: Record<string, Array<{ time: string }>>;
      };

      // Cal.com returns `{ data: { "YYYY-MM-DD": [{ time: ISO }, ...] } }`
      const slots: TimeSlot[] = [];
      for (const dailySlots of Object.values(data.data ?? {})) {
        for (const s of dailySlots) {
          const start = new Date(s.time);
          slots.push({
            start: start.toISOString(),
            end: new Date(start.getTime() + slotMinutes * 60 * 1000).toISOString(),
          });
        }
      }
      return slots;
    },

    async createBooking(r: BookingWrite): Promise<BookingWriteResult> {
      // Cal.com requires an attendee email; without one it cannot book.
      if (!r.clientEmail) {
        return {
          ok: false,
          reason: "Cal.com requires an email address for the attendee.",
        };
      }

      const start = new Date(r.startsAt);
      const end = new Date(start.getTime() + r.durationMinutes * 60 * 1000);

      try {
        const res = await fetch(`${CAL_API_BASE}/bookings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            start: start.toISOString(),
            eventTypeId: Number(cfg.eventTypeId),
            attendee: {
              name: r.clientName,
              email: r.clientEmail,
              timeZone: cfg.timeZone,
              language: "en",
              phoneNumber: r.clientPhone,
            },
            metadata: {
              assignedTo: r.stylistName,
              notes: r.notes ?? "",
              source: "call-assistant",
            },
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(
            `[CALCOM] /bookings failed (${res.status}): ${text.slice(0, 300)}`
          );
          return {
            ok: false,
            reason: `Cal.com booking failed (${res.status}).`,
            conflict: res.status === 409,
          };
        }

        const data = (await res.json()) as {
          data?: { uid?: string; id?: number | string };
        };
        const ref =
          data.data?.uid ??
          (data.data?.id !== undefined ? String(data.data.id) : null);

        if (!ref) return { ok: false, reason: "Cal.com returned no booking id." };

        return {
          ok: true,
          ref,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        };
      } catch (err) {
        console.error("[CALCOM] /bookings threw:", err);
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "Cal.com request failed.",
        };
      }
    },
  };
}
