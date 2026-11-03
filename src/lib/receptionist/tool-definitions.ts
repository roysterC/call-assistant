/**
 * The receptionist's tools: the definitions the model is given, chosen from
 * what the salon's booking provider can actually do (buildVoiceTools).
 *
 * The tools and the instructions' stance on availability (instructions.ts)
 * come from the same capability object, so they cannot contradict each other.
 * Instructions that say "you may confirm" beside a provider that cannot read
 * a diary is how callers get told a slot is free when nobody knows. The tools
 * enforce the same rules themselves, whatever was said.
 */

import type { BookingCapabilities } from "@/lib/booking";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const SAVE_CUSTOMER_DETAILS: ToolDefinition = {
  type: "function",
  function: {
    name: "save_customer_details",
    description:
      "Save the caller's contact details and what they want, for the salon " +
      "to ring them back about. Call this as soon as you have a name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The caller's full name" },
        phone: {
          type: "string",
          description:
            "Best contact number, as the caller said it. It is checked " +
            "and normalised here, so send the digits rather than trying " +
            "to format them.",
        },
        issue: {
          type: "string",
          description:
            "What they want: service, stylist, preferred times, and anything " +
            "else relevant.",
        },
        callerNumber: {
          type: "string",
          description:
            "The number they are ringing from, if the tool supplies it. Used " +
            "only when the number they spoke cannot be parsed.",
        },
      },
      // Name and issue are saved even when the number cannot be parsed, so
      // call this as soon as you have anything rather than waiting.
      required: [],
    },
  },
};

const CHECK_AVAILABILITY: ToolDefinition = {
  type: "function",
  function: {
    name: "check_availability",
    description:
      "Check the real diary for open appointment times. Always call this " +
      "before offering any time to a caller. Never guess or invent times.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "The day to check, in the caller's own words — 'Thursday', " +
            "'tomorrow', 'Tuesday week', 'the 3rd', '3rd of October' — which " +
            "is resolved against the salon's own clock. Only send YYYY-MM-DD " +
            "if you are copying an actual date. Never guess a date. Leave it empty if they did not " +
            "name a day and just want the soonest — send prefer='earliest' " +
            "instead.",
        },
        service: {
          type: "string",
          description:
            "Everything the caller wants done, e.g. 'cut and finish', " +
            "'balayage'. Required — it determines how long is needed. If " +
            "they asked for more than one thing, name them all in one " +
            "string: 'haircut and balayage'. Checking for only one of them " +
            "offers a time too short for the work.",
        },
        timeOfDay: {
          type: "string",
          enum: ["morning", "afternoon", "evening"],
          description:
            "Pass this whenever the caller expresses a preference, so they " +
            "are not offered times they have already ruled out.",
        },
        after: {
          type: "string",
          description:
            "Earliest acceptable start as HH:MM, 24-hour. Use for 'after 5' " +
            "or 'not before half two'.",
        },
        before: {
          type: "string",
          description: "Latest acceptable start as HH:MM, 24-hour.",
        },
        prefer: {
          type: "string",
          enum: ["earliest", "any"],
          description:
            "Send 'earliest' when they asked for the soonest appointment " +
            "rather than a choice of times — 'when's your next free slot', " +
            "'as soon as possible'. The diary is then searched forward over " +
            "the following two weeks, so no day is needed. Otherwise leave " +
            "it.",
        },
        time: {
          type: "string",
          description:
            "The one time they asked for, if they asked for one, as they " +
            "said it ('3', '2pm', 'half two'). A bare hour is read inside " +
            "opening hours, so never ask am or pm. If it is free it is offered " +
            "on its own; if not, the nearest times are.",
        },
        lookFurther: {
          type: "boolean",
          description:
            "Send true to look a month ahead instead of two weeks, but only " +
            "after the tool found nothing in two weeks and the caller said " +
            "they could wait longer.",
        },
        stylist: {
          type: "string",
          description: "Preferred stylist's name, if the caller named one",
        },
        customerName: {
          type: "string",
          description:
            "The name of the person it is for, once you have it. For a colour " +
            "service, get it before checking: with their number it finds " +
            "whether they have been before, which decides the earliest times.",
        },
        clientType: {
          type: "string",
          enum: ["new", "returning", "unknown"],
          description:
            "Leave this out: whether they have been before is worked out from " +
            "their name and number, as is a patch test on the salon's records. " +
            "Only send it once a tool has asked you to find out.",
        },
      },
      required: ["date", "service"],
    },
  },
};

/**
 * What a booking is made of. prepare_booking takes these and books nothing;
 * book_appointment then books what was read back.
 */
const BOOKING_DETAILS: ToolDefinition = {
  type: "function",
  function: {
    name: "book_appointment",
    description:
      "Put a confirmed appointment in the diary. Only call this after " +
      "check_availability offered the time, you have summed the booking up " +
      "(service, day and time, name, where the text goes) and the caller said " +
      "yes to it. Pass " +
      "the exact startsAt value that check_availability returned as `time`.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "The appointment day, in the caller's own words ('Thursday', " +
            "'Tuesday week', 'the 3rd') or YYYY-MM-DD; resolved against the " +
            "salon's clock.",
        },
        time: {
          type: "string",
          description:
            "The exact startsAt value from check_availability, " +
            "or the time as they said it ('3', 'half two'). A bare hour is read " +
            "inside opening hours, so never ask am or pm.",
        },
        service: {
          type: "string",
          description:
            "Everything being booked. If the caller asked for more than one " +
            "thing, name them all in one string — 'haircut and balayage' — " +
            "exactly as you checked availability for. Booking one of two " +
            "services puts half the appointment in the diary.",
        },
        stylist: { type: "string", description: "The stylist's name" },
        customerPhone: {
          type: "string",
          description:
            "Caller's number. Checked here — if it comes back as too " +
            "long or too short, read it back to them and try again.",
        },
        callerNumber: {
          type: "string",
          description:
            "The number they are ringing from, if the tool supplies it. Used " +
            "only when the number they spoke cannot be parsed.",
        },
        customerName: {
          type: "string",
          description:
            "The name of the person the appointment is for, as the caller " +
            "gave it: the caller's own, or the person they are booking for " +
            "(a parent booking for a child gives the child's). Required — you " +
            "cannot book without it. If you did not hear it clearly, ask again, and ask " +
            "them to spell it out letter by letter rather than guessing. " +
            "Never send a placeholder such as 'Unknown' or 'Customer'.",
        },
        clientType: {
          type: "string",
          enum: ["new", "returning", "unknown"],
          description:
            "Leave this out: whether they have been before is worked out from " +
            "their name and number, as is a patch test on the salon's records. " +
            "Only send it once a tool has asked you to find out.",
        },
        notes: { type: "string", description: "Anything the stylist should know" },
      },
      required: ["date", "time", "service", "customerPhone", "customerName"],
    },
  },
};

/**
 * Our own receptionist books in two steps, read back in between (see
 * src/lib/receptionist/read-back.ts). The first takes everything
 * book_appointment used to and books nothing.
 */
const PREPARE_BOOKING: ToolDefinition = {
  type: "function",
  function: {
    name: "prepare_booking",
    description:
      "Check a booking and get its details to read back to the caller. Nothing is " +
      "booked. Call it once they have picked a time that check_availability " +
      "offered and you have their name. Pass the exact startsAt value " +
      "check_availability returned as `time`.",
    parameters: BOOKING_DETAILS.function.parameters,
  },
};

const BOOK_PREPARED: ToolDefinition = {
  type: "function",
  function: {
    name: "book_appointment",
    description:
      "Book what prepare_booking read back, once the caller has said yes to it. " +
      "Refused if they have not answered the read-back yet.",
    parameters: {
      type: "object",
      properties: {
        bookingRef: {
          type: "string",
          description: "The bookingRef prepare_booking gave you.",
        },
      },
      required: ["bookingRef"],
    },
  },
};

const BOOK_CALLBACK: ToolDefinition = {
  type: "function",
  function: {
    name: "book_callback",
    description:
      "Record that the salon should ring this caller back to confirm their " +
      "request. Use this when you cannot book directly.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date to ring back, YYYY-MM-DD" },
        time: { type: "string", description: "Time to ring back, HH:MM" },
        customerPhone: { type: "string", description: "Caller's number" },
        customerName: {
          type: "string",
          description:
            "The caller's name. Required — ask them to spell it out rather " +
            "than guessing, and never send a placeholder.",
        },
        assignedTo: { type: "string", description: "Stylist requested, if any" },
        notes: {
          type: "string",
          description: "The full request: service, stylist, preferred times.",
        },
      },
      required: ["date", "customerPhone", "customerName"],
    },
  },
};

const TAKE_MESSAGE: ToolDefinition = {
  type: "function",
  function: {
    name: "take_message",
    description:
      "Leave a message for the salon to ring the caller back. Use it whenever " +
      "the caller asks to speak to a person, or wants something you cannot do " +
      "or answer. Nobody can be put through, so this is how they reach a " +
      "person. Call it as soon as you have their name and what it is about.",
    parameters: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description:
            "The caller's name. Required: ask for it, and never send a placeholder.",
        },
        customerPhone: {
          type: "string",
          description:
            "The best number to ring them back on, as they said it. Leave it " +
            "out to use the number they are ringing from.",
        },
        message: {
          type: "string",
          description:
            "What they want, in a sentence or two and in their words: enough " +
            "for the salon to ring back ready to help.",
        },
        forStylist: {
          type: "string",
          description: "The stylist it is for, if they named one.",
        },
        callerNumber: {
          type: "string",
          description: "The number they are ringing from, if the tool supplies it.",
        },
      },
      required: ["customerName", "message"],
    },
  },
};

const FIND_APPOINTMENT: ToolDefinition = {
  type: "function",
  function: {
    name: "find_appointment",
    description:
      "Look up a caller's upcoming appointment by their phone number. Use " +
      "this when someone rings about an existing booking. Read the details " +
      "back before changing anything.",
    parameters: {
      type: "object",
      properties: {
        customerPhone: {
          type: "string",
          description:
            "The number the appointment was booked under. Leave it empty " +
            "for the number they are ringing from.",
        },
        callerName: {
          type: "string",
          description:
            "The name of the person you are speaking to (not the person the " +
            "booking is for). Needed when the booking is on a number other " +
            "than the one they are ringing from.",
        },
        bookingNumber: {
          type: "string",
          description:
            "The booking number from their confirmation text, if they have " +
            "it. With bookingName, enough to find the booking, whoever is calling.",
        },
        bookingName: {
          type: "string",
          description:
            "The name the booking is under, as the caller gave it. Needed " +
            "with bookingNumber.",
        },
      },
      required: [],
    },
  },
};

const CANCEL_APPOINTMENT: ToolDefinition = {
  type: "function",
  function: {
    name: "cancel_appointment",
    description:
      "Cancel an existing appointment and free the slot. Confirm which " +
      "appointment you are cancelling with the caller first. If they have " +
      "more than one booked, this returns the list and you must ask which.",
    parameters: {
      type: "object",
      properties: {
        customerPhone: {
          type: "string",
          description:
            "The number the appointment was booked under. Leave it empty " +
            "for the number they are ringing from.",
        },
        callerName: {
          type: "string",
          description:
            "The name of the person you are speaking to (not the person the " +
            "booking is for). Needed when the booking is on a number other " +
            "than the one they are ringing from.",
        },
        bookingNumber: {
          type: "string",
          description:
            "The booking number from their confirmation text, if they have " +
            "it. With bookingName, enough to find the booking, whoever is calling.",
        },
        bookingName: {
          type: "string",
          description:
            "The name the booking is under, as the caller gave it. Needed " +
            "with bookingNumber.",
        },
        appointmentId: {
          type: "string",
          description:
            "Only needed when they have several booked — use the " +
            "appointmentId from find_appointment.",
        },
        reason: {
          type: "string",
          description: "Why, if they say. Recorded for the salon.",
        },
      },
      required: [],
    },
  },
};

const RESCHEDULE_APPOINTMENT: ToolDefinition = {
  type: "function",
  function: {
    name: "reschedule_appointment",
    description:
      "Move an existing appointment to a new time. Check the new time with " +
      "check_availability first and pass the exact startsAt it returned. The " +
      "original is kept if the new time cannot be taken, so the caller is " +
      "never left with nothing.",
    parameters: {
      type: "object",
      properties: {
        customerPhone: {
          type: "string",
          description:
            "The number the appointment was booked under. Leave it empty " +
            "for the number they are ringing from.",
        },
        callerName: {
          type: "string",
          description:
            "The name of the person you are speaking to (not the person the " +
            "booking is for). Needed when the booking is on a number other " +
            "than the one they are ringing from.",
        },
        bookingNumber: {
          type: "string",
          description:
            "The booking number from their confirmation text, if they have " +
            "it. With bookingName, enough to find the booking, whoever is calling.",
        },
        bookingName: {
          type: "string",
          description:
            "The name the booking is under, as the caller gave it. Needed " +
            "with bookingNumber.",
        },
        appointmentId: {
          type: "string",
          description: "Only needed when they have several booked",
        },
        date: {
          type: "string",
          description:
            "The new day, in the caller's own words ('Thursday', 'Tuesday " +
            "week', 'the 3rd') or YYYY-MM-DD; resolved against the salon's clock.",
        },
        time: {
          type: "string",
          description:
            "The exact startsAt from check_availability, " +
            "or the time as they said it ('3', 'half two'). A bare hour is read " +
            "inside opening hours, so never ask am or pm.",
        },
        stylist: {
          type: "string",
          description:
            "Only if they want a different stylist. Otherwise the original " +
            "one is kept.",
        },
      },
      required: ["date", "time"],
    },
  },
};

/**
 * The tool list for a given capability set.
 *
 * `check_availability` is *absent*, not disabled, when the provider cannot
 * read a diary — an absent tool cannot be called by mistake, and every tool
 * schema costs prefill tokens on every turn of the call.
 */
export function buildVoiceTools(caps: BookingCapabilities): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  // Only where nothing can be booked: a booking records the client itself.
  // Offered beside booking, it was called "before booking" as its old
  // description said, and on a shared phone it left a stray message on the
  // other person's record.
  if (!caps.createBooking) tools.push(SAVE_CUSTOMER_DETAILS);
  if (caps.readAvailability) tools.push(CHECK_AVAILABILITY);
  if (caps.createBooking) {
    tools.push(PREPARE_BOOKING, BOOK_PREPARED);
    // Changing a booking needs the same write access as making one. On an
    // after-hours line these matter as much as new bookings — someone
    // realising at nine at night that tomorrow will not work.
    tools.push(FIND_APPOINTMENT, CANCEL_APPOINTMENT, RESCHEDULE_APPOINTMENT);
  }
  // Only offer the callback path when there is no way to book directly.
  // Failed bookings are converted to callbacks server-side, so the agent does
  // not need this tool when it can book.
  if (!caps.createBooking) tools.push(BOOK_CALLBACK);
  // Whatever the diary can do: "can I speak to someone?" and "I can't help
  // with that" end in a message the salon rings back about.
  tools.push(TAKE_MESSAGE);
  return tools;
}
