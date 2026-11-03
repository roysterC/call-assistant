import { handleBookCallback, handleTakeMessage } from "./messages";
import { handleBookAppointment, handleSaveCustomerDetails } from "./booking";
import { handleCancelAppointment, handleFindAppointment, handleRescheduleAppointment } from "./changes";
import { handleCheckAvailability } from "./availability";

/**
 * What the receptionist can do: check availability, book, find, move and
 * cancel appointments, take a message, book a call-back, save a caller's
 * details. Each action checks the salon's rules itself (hours, who does
 * what, the skin test, no double-booking), whoever asks.
 *
 * Callers: our own phone line and the lab (receptionist/session.ts), and the
 * diary's assistant (voice-booking/), which asks the diary through
 * check_availability.
 */

export {
  handleBookAppointment,
  handleBookCallback,
  handleCancelAppointment,
  handleCheckAvailability,
  handleFindAppointment,
  handleRescheduleAppointment,
  handleSaveCustomerDetails,
  handleTakeMessage,
};

export type ActionName =
  | "save_customer_details"
  | "book_callback"
  | "check_availability"
  | "book_appointment"
  | "find_appointment"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "take_message";

export const ACTION_NAMES: ActionName[] = [
  "save_customer_details",
  "book_callback",
  "check_availability",
  "book_appointment",
  "find_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "take_message",
];

export function isActionName(name: string): name is ActionName {
  return (ACTION_NAMES as string[]).includes(name);
}

/**
 * The handlers are written for strings; a model does not always send them.
 * `service: 123` crashed on `.trim()` rather than getting an answer. Numbers
 * become text, and null becomes absent, which every handler already treats
 * as "not given". Anything else is left for the handler's own checks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normaliseParameters(parameters: Record<string, any> | null | undefined): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (value === null) continue;
    out[key] = typeof value === "number" ? String(value) : value;
  }
  return out;
}

/**
 * A refused booking says so first, whatever the reason. The reasons read as
 * next steps ("which stylist is that with?"), and after three of them in a
 * row one call answered the next "just book it" with "that's booked in".
 */
export function saysNotBooked<T>(result: T): T {
  const r = result as { success?: boolean; message?: unknown };
  if (r && r.success === false && typeof r.message === "string" && !r.message.startsWith("NOT booked")) {
    return { ...r, message: `NOT booked. ${r.message}` } as T;
  }
  return result;
}

/**
 * Route a named call to its handler.
 *
 * Parameters are deliberately loose: the model does not always use the field
 * names in the schema, so each handler normalises what it is given rather than
 * relying on the caller to have got it right.
 */
export async function runAction(
  name: string,
  organizationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any>
): Promise<unknown> {
  parameters = normaliseParameters(parameters);
  switch (name) {
    case "save_customer_details":
      return handleSaveCustomerDetails(organizationId, parameters as Parameters<typeof handleSaveCustomerDetails>[1]);
    case "book_callback":
      return handleBookCallback(organizationId, parameters as Parameters<typeof handleBookCallback>[1]);
    case "check_availability":
      return handleCheckAvailability(organizationId, parameters as Parameters<typeof handleCheckAvailability>[1]);
    case "book_appointment":
      return saysNotBooked(
        await handleBookAppointment(organizationId, parameters as Parameters<typeof handleBookAppointment>[1])
      );
    case "find_appointment":
      return handleFindAppointment(organizationId, parameters as Parameters<typeof handleFindAppointment>[1]);
    case "cancel_appointment":
      return handleCancelAppointment(organizationId, parameters as Parameters<typeof handleCancelAppointment>[1]);
    case "reschedule_appointment":
      return handleRescheduleAppointment(organizationId, parameters as Parameters<typeof handleRescheduleAppointment>[1]);
    case "take_message":
      return handleTakeMessage(organizationId, parameters as Parameters<typeof handleTakeMessage>[1]);
    default:
      return { error: `Unknown function: ${name}` };
  }
}
