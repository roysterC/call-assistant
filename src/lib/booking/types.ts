/**
 * Booking provider contract.
 *
 * The salon's diary lives in Google Calendar (one calendar per stylist), but
 * other tenants use Cal.com or nothing at all. Rather than a lowest-common-
 * denominator CRUD interface, providers declare what they can actually do and
 * the optional methods are only present when the capability is true.
 *
 * That is deliberate: it makes the old `stubSlots()` hazard — inventing
 * availability when the real thing is unreachable — a compile error rather
 * than a code-review question.
 */

export interface TimeSlot {
  /** ISO 8601 instant. */
  start: string;
  end: string;
  /** Which stylist this slot belongs to. Always set by per-staff providers. */
  stylistName?: string;
  calendarId?: string;
}

export interface AvailabilityQuery {
  organizationId: string;
  /** YYYY-MM-DD in the organization's timezone. */
  date: string;
  /** Service name as spoken by the caller; resolved against org config. */
  serviceName?: string;
  /** Caller's stylist preference, if any. */
  stylistName?: string;
  /** Drives the patch-test lead time for colour services. */
  clientType?: "new" | "returning" | "unknown";
  /**
   * Look forward from `date` up to this many calendar days, for "when are you
   * next free?". Defaults to 1 — that day only.
   *
   * Only meaningful when `capabilities.forwardSearch`. A provider without it
   * returns the single day, which is honest but narrower than asked; the
   * capability flag is what lets the caller word the answer truthfully
   * instead of claiming a fortnight was searched.
   */
  searchDays?: number;
}

export interface BookingWrite {
  organizationId: string;
  /** ISO 8601 instant. */
  startsAt: string;
  durationMinutes: number;
  serviceName: string;
  stylistName: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
  notes?: string;
  /** Written into the calendar event so a booking can be traced back. */
  leadId?: string;
}

/**
 * No lying-true.
 *
 * The old `bookCallback` returned `success: true` even when Cal.com failed,
 * because losing a lead was worse than losing a calendar event. That is right
 * for a callback and wrong for a confirmed appointment — if the write failed,
 * the agent must not tell the caller they are booked in.
 */
export type BookingWriteResult =
  | {
      ok: true;
      /** Provider-side identifier (Google event id, Cal.com uid, ...). */
      ref: string;
      calendarId?: string;
      startsAt: string;
      endsAt: string;
    }
  | {
      ok: false;
      reason: string;
      /** True when the slot was taken between offer and write. */
      conflict?: boolean;
    };

export interface BookingCapabilities {
  /** Can return REAL free/busy for a date. Never a guess. */
  readAvailability: boolean;
  /** Can write a booking the caller can rely on. */
  createBooking: boolean;
  /** Availability resolves per stylist, not just salon-wide. */
  perStaffAvailability: boolean;
  /** `AvailabilityQuery.searchDays` is honoured, not ignored. */
  forwardSearch: boolean;
  /**
   * The data is a mirror that can lag its source, so the agent may suggest
   * but must not confirm. False for Google here — Google IS the diary.
   */
  availabilityIsAdvisory: boolean;
}

export interface BookingProvider {
  readonly id: "manual" | "calcom" | "google";
  readonly capabilities: BookingCapabilities;
  /** Present only when `capabilities.readAvailability`. */
  getAvailability?(q: AvailabilityQuery): Promise<TimeSlot[]>;
  /** Present only when `capabilities.createBooking`. */
  createBooking?(r: BookingWrite): Promise<BookingWriteResult>;
  /** Present only when `capabilities.createBooking`. */
  cancelBooking?(organizationId: string, ref: string, calendarId?: string): Promise<void>;
}

export type ReadableProvider = BookingProvider &
  Required<Pick<BookingProvider, "getAvailability">>;

export type WritableProvider = BookingProvider &
  Required<Pick<BookingProvider, "createBooking">>;

/**
 * Narrowing guards. Call sites must pass through these, which is what makes
 * "ask a provider for availability it cannot supply" fail the build.
 */
export function canReadAvailability(p: BookingProvider): p is ReadableProvider {
  return p.capabilities.readAvailability && typeof p.getAvailability === "function";
}

export function canCreateBooking(p: BookingProvider): p is WritableProvider {
  return p.capabilities.createBooking && typeof p.createBooking === "function";
}
