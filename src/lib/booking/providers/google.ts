/**
 * Google Calendar booking provider.
 *
 * The salon's diary lives here — one calendar per stylist — so this provider
 * is authoritative, not advisory. It may confirm.
 *
 * Auth is a service account with each stylist calendar shared to its address
 * ("Make changes to events"). Not three-legged OAuth: Calendar is a sensitive
 * scope, so a consent screen serving external users needs Google verification
 * review, and OAuth would add refresh-token storage, rotation and revocation
 * handling. A service account needs none of that and works with personal
 * Gmail calendars as well as Workspace.
 */

import { google, type calendar_v3 } from "googleapis";
import type { BusinessHours } from "@/lib/business-hours";
import {
  matchService,
  matchStylist,
  stylistsForService,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";
import {
  computeBookableSlots,
  type BusyBlock,
  type StylistAvailability,
} from "../availability";
import type {
  AvailabilityQuery,
  BookingProvider,
  BookingWrite,
  BookingWriteResult,
  TimeSlot,
} from "../types";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export interface GoogleProviderConfig {
  timeZone: string;
  hours: BusinessHours;
  services: SalonService[];
  stylists: Stylist[];
}

export function googleCredentialsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
  );
}

let cachedClient: calendar_v3.Calendar | null = null;

function calendarClient(): calendar_v3.Calendar {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "Google Calendar not configured: set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY"
    );
  }

  // Env vars cannot carry real newlines, so the PEM is stored with escaped
  // ones and unescaped here. Also tolerate a surrounding pair of quotes,
  // which several hosting dashboards add silently.
  const key = rawKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({ email, key, scopes: SCOPES });
  cachedClient = google.calendar({ version: "v3", auth });
  return cachedClient;
}

/** Exposed for the health check on the admin sync button. */
export function resetGoogleClientCache(): void {
  cachedClient = null;
}

// -------------------------------------------------------------------------
// Free/busy
// -------------------------------------------------------------------------

/**
 * Busy blocks for several calendars in ONE request.
 *
 * `freebusy.query` takes up to 50 calendar ids, so a five-stylist salon costs
 * a single call. Listing events per calendar would be five, plus pagination.
 */
async function fetchBusy(
  calendarIds: string[],
  timeMin: Date,
  timeMax: Date
): Promise<Map<string, BusyBlock[]>> {
  const out = new Map<string, BusyBlock[]>();
  if (calendarIds.length === 0) return out;

  const res = await calendarClient().freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    },
  });

  const calendars = res.data.calendars ?? {};
  for (const id of calendarIds) {
    const entry = calendars[id];

    // A calendar we cannot read must NOT look empty — an empty busy list
    // reads as "free all day" and would double-book the stylist. Fail loudly.
    if (!entry || (entry.errors && entry.errors.length > 0)) {
      const reason = entry?.errors?.map((e) => e.reason).join(", ") || "not returned";
      throw new Error(`Google Calendar unreadable for ${id}: ${reason}`);
    }

    out.set(
      id,
      (entry.busy ?? [])
        .filter((b) => b.start && b.end)
        .map((b) => ({
          start: new Date(b.start as string),
          end: new Date(b.end as string),
          calendarId: id,
        }))
    );
  }

  return out;
}

// -------------------------------------------------------------------------
// Provider
// -------------------------------------------------------------------------

export function createGoogleProvider(
  cfg: GoogleProviderConfig
): BookingProvider {
  async function candidatesFor(
    service: SalonService,
    stylistPreference: string | undefined,
    dayStart: Date,
    dayEnd: Date
  ): Promise<StylistAvailability[]> {
    let pool = stylistsForService(service, cfg.stylists);

    const preferred = matchStylist(stylistPreference, cfg.stylists);
    if (preferred) {
      // Honour the request even if the roster says they do not list this
      // service — "I always see Jo" is most of a salon's repeat business, and
      // the config is likelier to be incomplete than the client is to be wrong.
      pool = pool.some((s) => s.name === preferred.name)
        ? [preferred]
        : preferred.googleCalendarId
          ? [preferred]
          : [];
    }

    const ids = pool
      .map((s) => s.googleCalendarId)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    const busyByCalendar = await fetchBusy(ids, dayStart, dayEnd);

    return pool
      .filter((s) => s.googleCalendarId)
      .map((stylist) => ({
        stylist,
        busy: busyByCalendar.get(stylist.googleCalendarId as string) ?? [],
      }));
  }

  return {
    id: "google",

    capabilities: {
      readAvailability: true,
      createBooking: true,
      perStaffAvailability: true,
      // Google IS the diary, not a mirror of one. The agent may confirm.
      availabilityIsAdvisory: false,
    },

    async getAvailability(q: AvailabilityQuery): Promise<TimeSlot[]> {
      const service = matchService(q.serviceName, cfg.services);
      if (!service) return [];

      // Widen the free/busy window by a day either side so appointments that
      // straddle midnight in the salon's timezone are still seen.
      const dayStart = new Date(`${q.date}T00:00:00Z`);
      const timeMin = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
      const timeMax = new Date(dayStart.getTime() + 48 * 60 * 60 * 1000);

      const candidates = await candidatesFor(
        service,
        q.stylistName,
        timeMin,
        timeMax
      );
      if (candidates.length === 0) return [];

      return computeBookableSlots({
        date: q.date,
        timeZone: cfg.timeZone,
        hours: cfg.hours,
        service,
        candidates,
        clientType: q.clientType ?? "unknown",
      });
    },

    async createBooking(r: BookingWrite): Promise<BookingWriteResult> {
      const stylist = matchStylist(r.stylistName, cfg.stylists);
      if (!stylist?.googleCalendarId) {
        return {
          ok: false,
          reason: `No calendar configured for stylist "${r.stylistName}"`,
        };
      }

      const start = new Date(r.startsAt);
      const end = new Date(start.getTime() + r.durationMinutes * 60 * 1000);

      // Re-check immediately before writing. Between the agent offering 2pm
      // and the caller saying yes, thirty seconds may pass — and a second
      // caller may be on another line. The window is small; it is not zero.
      try {
        const busy = await fetchBusy([stylist.googleCalendarId], start, end);
        const blocks = busy.get(stylist.googleCalendarId) ?? [];
        const clash = blocks.some((b) => start < b.end && b.start < end);
        if (clash) {
          return {
            ok: false,
            conflict: true,
            reason: "That time was taken while we were talking.",
          };
        }
      } catch (err) {
        // Could not verify, so do not write. Claiming a booking we could not
        // confirm is the worst outcome available here.
        console.error("[GOOGLE] Pre-insert free/busy check failed:", err);
        return {
          ok: false,
          reason: "Could not verify the diary is still free.",
        };
      }

      try {
        const res = await calendarClient().events.insert({
          calendarId: stylist.googleCalendarId,
          requestBody: {
            summary: `${r.serviceName} — ${r.clientName}`,
            description: [
              `Client: ${r.clientName}`,
              `Phone: ${r.clientPhone}`,
              r.clientEmail ? `Email: ${r.clientEmail}` : null,
              r.notes ? `Notes: ${r.notes}` : null,
              "",
              "Booked by the AI receptionist.",
            ]
              .filter(Boolean)
              .join("\n"),
            start: { dateTime: start.toISOString(), timeZone: cfg.timeZone },
            end: { dateTime: end.toISOString(), timeZone: cfg.timeZone },
            extendedProperties: {
              private: {
                source: "call-assistant",
                ...(r.leadId ? { leadId: r.leadId } : {}),
              },
            },
          },
        });

        const id = res.data.id;
        if (!id) {
          return { ok: false, reason: "Google returned no event id." };
        }

        return {
          ok: true,
          ref: id,
          calendarId: stylist.googleCalendarId,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        };
      } catch (err) {
        console.error("[GOOGLE] events.insert failed:", err);
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "Calendar write failed.",
        };
      }
    },

    async cancelBooking(
      _organizationId: string,
      ref: string,
      calendarId?: string
    ): Promise<void> {
      if (!calendarId) throw new Error("cancelBooking requires a calendarId");
      await calendarClient().events.delete({ calendarId, eventId: ref });
    },
  };
}

/**
 * Confirm every configured calendar is readable AND writable.
 *
 * Surfaced on the admin "Sync voice agent" button. A revoked share or a
 * deleted calendar otherwise fails silently at 11pm, when nobody is looking.
 */
export async function checkGoogleCalendarAccess(
  stylists: Stylist[]
): Promise<Array<{ stylist: string; calendarId: string; ok: boolean; error?: string }>> {
  const client = calendarClient();
  const results: Array<{
    stylist: string;
    calendarId: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const s of stylists) {
    if (!s.googleCalendarId) {
      results.push({
        stylist: s.name,
        calendarId: "",
        ok: false,
        error: "No calendar id configured",
      });
      continue;
    }
    try {
      const meta = await client.calendars.get({
        calendarId: s.googleCalendarId,
      });
      // `calendars.get` succeeds with read access, so check the access role
      // explicitly — a read-only share would fail only at booking time.
      const entry = await client.calendarList
        .get({ calendarId: s.googleCalendarId })
        .catch(() => null);
      const role = entry?.data.accessRole ?? null;
      const writable = role === null || role === "writer" || role === "owner";
      results.push({
        stylist: s.name,
        calendarId: s.googleCalendarId,
        ok: Boolean(meta.data.id) && writable,
        error: writable ? undefined : `Access role is "${role}", needs writer`,
      });
    } catch (err) {
      results.push({
        stylist: s.name,
        calendarId: s.googleCalendarId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
