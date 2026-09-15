import type { BookingProvider } from "../types";

/**
 * The honest default for an organization with no diary configured.
 *
 * Note what is absent: there is no `getAvailability` and no `createBooking`.
 * That is the entire point. The old `stubSlots()` fabricated 9-to-5 slots so
 * that `check_availability` always had something to say, and a voice agent
 * read those invented times to callers. Here the capability is simply not
 * present, so a call site that tries to ask for availability fails to compile
 * rather than shipping a plausible lie.
 *
 * Organizations on this provider take booking *requests*; staff confirm them.
 */
export const manualProvider: BookingProvider = {
  id: "manual",
  capabilities: {
    readAvailability: false,
    createBooking: false,
    perStaffAvailability: false,
    forwardSearch: false,
    availabilityIsAdvisory: false,
  },
};
