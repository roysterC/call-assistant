/**
 * Generates the Vapi assistant's tool list and prompt from what the booking
 * provider can actually do, and pushes it to Vapi.
 *
 * Vapi assistants are configured in Vapi's console, so this repo cannot be
 * their source of truth — but it can be the generator. The point is that the
 * attached tools and the prompt's stance on availability are produced from one
 * capability object, so they cannot contradict each other. A prompt that says
 * "you may confirm" beside a provider that cannot read a diary is how callers
 * get told a slot is free when nobody knows.
 *
 * Server-side enforcement still exists independently in the functions route:
 * console drift must not be able to produce a lie.
 */

import { prisma } from "@/lib/prisma";
import { describeHoursForPrompt } from "@/lib/business-hours";
import { describeServicesForPrompt } from "@/lib/salon-config";
import {
  explainProviderSelection,
  getSalonConfig,
  selectProvider,
  type BookingCapabilities,
  type SalonConfig,
} from "@/lib/booking";
import { getAssistant, updateAssistant } from "@/lib/vapi";

export interface VapiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// -------------------------------------------------------------------------
// Tools
// -------------------------------------------------------------------------

const SAVE_CUSTOMER_DETAILS: VapiTool = {
  type: "function",
  function: {
    name: "save_customer_details",
    description:
      "Save the caller's contact details and what they are calling about. " +
      "Call this as soon as you have a name and number, before booking.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The caller's full name" },
        email: { type: "string", description: "Email address, if offered" },
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
            "What they want: service, stylist, preferred times, new or " +
            "returning client, and anything else relevant.",
        },
      },
      required: ["phone"],
    },
  },
};

const CHECK_AVAILABILITY: VapiTool = {
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
            "The day to check. A weekday name is fine and preferred — " +
            "'Thursday', 'tomorrow', 'today' — and is resolved against the " +
            "salon's own clock. Only send YYYY-MM-DD if the caller named an " +
            "actual date. Never guess a date.",
        },
        service: {
          type: "string",
          description:
            "The service the caller wants, e.g. 'cut and finish', " +
            "'balayage'. Required — it determines how long is needed.",
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
        stylist: {
          type: "string",
          description: "Preferred stylist's name, if the caller named one",
        },
        clientType: {
          type: "string",
          enum: ["new", "returning", "unknown"],
          description:
            "Whether the caller has been to the salon before. Colour " +
            "services need a patch test for new clients.",
        },
      },
      required: ["date", "service"],
    },
  },
};

const BOOK_APPOINTMENT: VapiTool = {
  type: "function",
  function: {
    name: "book_appointment",
    description:
      "Put a confirmed appointment in the diary. Only call this after " +
      "check_availability offered the time and the caller accepted it. Pass " +
      "the exact startsAt value that check_availability returned as `time`.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description:
            "The appointment day. A weekday name such as 'Thursday' is " +
            "accepted and resolved against the salon's clock.",
        },
        time: {
          type: "string",
          description:
            "The exact startsAt value from check_availability, or HH:MM " +
            "in 24-hour format.",
        },
        service: { type: "string", description: "The service being booked" },
        stylist: { type: "string", description: "The stylist's name" },
        customerPhone: {
          type: "string",
          description:
            "Caller's number. Checked here — if it comes back as too " +
            "long or too short, read it back to them and try again.",
        },
        customerName: { type: "string", description: "Caller's name" },
        clientType: {
          type: "string",
          enum: ["new", "returning", "unknown"],
          description: "Whether they have been to the salon before",
        },
        notes: { type: "string", description: "Anything the stylist should know" },
      },
      required: ["date", "time", "service", "customerPhone"],
    },
  },
};

const BOOK_CALLBACK: VapiTool = {
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
        customerName: { type: "string", description: "Caller's name" },
        assignedTo: { type: "string", description: "Stylist requested, if any" },
        notes: {
          type: "string",
          description: "The full request: service, stylist, preferred times.",
        },
      },
      required: ["date", "customerPhone"],
    },
  },
};

const FIND_APPOINTMENT: VapiTool = {
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
          description: "The number the appointment was booked under",
        },
      },
      required: ["customerPhone"],
    },
  },
};

const CANCEL_APPOINTMENT: VapiTool = {
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
          description: "The number the appointment was booked under",
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
      required: ["customerPhone"],
    },
  },
};

const RESCHEDULE_APPOINTMENT: VapiTool = {
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
          description: "The number the appointment was booked under",
        },
        appointmentId: {
          type: "string",
          description: "Only needed when they have several booked",
        },
        date: {
          type: "string",
          description:
            "The new day. A weekday name such as 'Thursday' is accepted and " +
            "resolved against the salon's clock.",
        },
        time: {
          type: "string",
          description:
            "The exact startsAt from check_availability, or HH:MM in " +
            "24-hour format.",
        },
        stylist: {
          type: "string",
          description:
            "Only if they want a different stylist. Otherwise the original " +
            "one is kept.",
        },
      },
      required: ["customerPhone", "date", "time"],
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
export function buildVoiceTools(caps: BookingCapabilities): VapiTool[] {
  const tools: VapiTool[] = [SAVE_CUSTOMER_DETAILS];
  if (caps.readAvailability) tools.push(CHECK_AVAILABILITY);
  if (caps.createBooking) {
    tools.push(BOOK_APPOINTMENT);
    // Changing a booking needs the same write access as making one. On an
    // after-hours line these matter as much as new bookings — someone
    // realising at nine at night that tomorrow will not work.
    tools.push(FIND_APPOINTMENT, CANCEL_APPOINTMENT, RESCHEDULE_APPOINTMENT);
  }
  // Only offer the callback path when there is no way to book directly.
  // Failed bookings are converted to callbacks server-side, so the agent does
  // not need this tool when it can book.
  if (!caps.createBooking) tools.push(BOOK_CALLBACK);
  return tools;
}

// -------------------------------------------------------------------------
// Prompt
// -------------------------------------------------------------------------

/**
 * The availability stance, generated rather than written by hand.
 *
 * Three cases, and they must match the tools exactly.
 */
export function buildAvailabilityStance(caps: BookingCapabilities): string {
  if (!caps.readAvailability) {
    return `# The one thing you must never do

**You cannot see the diary.** You have no idea what is free.

Never say a slot is available, free, taken, or booked. Never confirm an
appointment. Never promise a specific stylist at a specific time.

What you are doing is taking a **request** so the salon can confirm it when
they open. Be clear about that without being apologetic:

> "I'll get that written down and someone will ring you first thing to confirm."

If the caller pushes — *"can you just book it?"* — hold the line politely:

> "I can't confirm the diary from here, but I'll make sure you're first on the
> list to be called back."`;
  }

  if (caps.availabilityIsAdvisory) {
    return `# Availability is a guide, not a promise

You can see a copy of the diary, but it can lag behind the real one, so a time
that looks free may already have gone.

Say *"that looks like it might be free"*, never *"that's booked in"*. Always
finish by telling the caller the salon will confirm.`;
  }

  return `# Booking

You can see the real diary, and you can book, move and cancel appointments in
it.

- **Always call \`check_availability\` before offering any time.** Never guess,
  never work it out yourself, and never offer a time the tool did not return.
- Offer at most two or three options. Reading a long list down the phone is
  worse than offering three good ones.
- When the caller picks one, call \`book_appointment\` straight away with the
  exact \`startsAt\` value that \`check_availability\` gave you for that option.
- Only once the tool confirms it worked may you say they are booked in. If it
  reports a clash, apologise and offer another time. If it fails any other way,
  say the salon will ring to confirm — **do not** tell them they are booked.
- You must know whether they are a new or returning client before booking any
  colour service. New clients need a skin patch test 48 hours beforehand, so
  the earliest colour appointment is two days away. Explain that plainly if it
  comes up; do not treat it as negotiable.

## Changing an existing appointment

Plenty of people ring after hours to cancel or move something, not to book.

- Ask for the number it was booked under, then \`find_appointment\`.
- **Read the appointment back before you change anything.** Service, stylist
  and time. Wait for them to confirm it is the right one.
- To move it, check the new time with \`check_availability\` first, then call
  \`reschedule_appointment\`. If the new slot has gone, their original is kept
  — say so, and offer something else.
- When cancelling, offer to rebook before you end the call. Someone who rings
  to cancel will often take another time if you ask.
- Never tell them it is done until the tool says so.`;
}

export interface ComposedPrompt {
  prompt: string;
  toolNames: string[];
  providerId: string;
  warnings: string[];
}

/**
 * Compose the live system prompt.
 *
 * Generated blocks (stance, hours, services) come first and are derived from
 * the same configuration the booking code enforces, so the hours the agent
 * speaks and the hours the code allows cannot drift apart. The human-written
 * body is stored on `OrganizationSettings.voiceSystemPrompt`, matching the
 * convention already used for every other channel.
 */
export function composeVoicePrompt(
  cfg: SalonConfig,
  body: string | null
): ComposedPrompt {
  const provider = selectProvider(cfg);
  const caps = provider.capabilities;

  const sections = [
    buildAvailabilityStance(caps),
    `# Opening hours\n\n${describeHoursForPrompt(cfg.hours, cfg.timeZone)}`,
    `# Services\n\n${describeServicesForPrompt(cfg.services)}`,
  ];

  if (body && body.trim()) sections.push(body.trim());

  const warnings: string[] = [];
  if (!body || !body.trim()) {
    warnings.push(
      "No voiceSystemPrompt is stored — the agent has only generated blocks."
    );
  }
  if (!caps.createBooking) {
    warnings.push(
      "This organization cannot book directly: " +
        (explainProviderSelection(cfg).join(" ") || "provider is manual.")
    );
  }

  return {
    prompt: sections.join("\n\n---\n\n"),
    toolNames: buildVoiceTools(caps).map((t) => t.function.name),
    providerId: provider.id,
    warnings,
  };
}

// -------------------------------------------------------------------------
// Sync
// -------------------------------------------------------------------------

export interface SyncResult {
  synced: boolean;
  dryRun: boolean;
  assistantId: string | null;
  providerId: string;
  /** Tools this organization's capabilities call for. */
  expectedTools: string[];
  /** Tool ids actually attached to the assistant in Vapi. */
  attachedToolCount: number | null;
  /** The exact body that was, or would be, sent. */
  payload?: Record<string, unknown>;
  warnings: string[];
}

/**
 * Push the composed prompt to the Vapi assistant.
 *
 * Prompt only, deliberately. Vapi holds tools as separate objects referenced
 * by `model.toolIds`, and each carries its own server URL and auth credential
 * — none of which the generated tool JSON knows about. Writing tools from here
 * would replace working, authenticated tools with definitions that point
 * nowhere. Tools stay managed in the console; this reports whether the number
 * attached matches what the capabilities call for, which is the part that
 * silently drifts.
 *
 * The prompt is the thing that actually goes stale: opening hours and the
 * service list are generated from settings, so the moment a tenant edits them
 * the agent starts saying something the booking engine will not honour.
 *
 * Reads the assistant before writing and merges, rather than PATCHing a bare
 * `model`. A partial model object risks dropping `provider`, `model`,
 * `toolIds` and `promptCacheRetention` — which would take the assistant down
 * rather than update it.
 */
export async function syncAssistant(
  organizationId: string,
  options: { dryRun?: boolean } = {}
): Promise<SyncResult> {
  const dryRun = Boolean(options.dryRun);

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { vapiAssistantId: true, voiceSystemPrompt: true },
  });

  const cfg = await getSalonConfig(organizationId);
  const composed = composeVoicePrompt(cfg, settings?.voiceSystemPrompt ?? null);
  const expectedTools = composed.toolNames;

  const assistantId = settings?.vapiAssistantId ?? null;
  if (!assistantId) {
    return {
      synced: false,
      dryRun,
      assistantId: null,
      providerId: composed.providerId,
      expectedTools,
      attachedToolCount: null,
      warnings: [
        ...composed.warnings,
        "No vapiAssistantId configured for this organization — nothing to push.",
      ],
    };
  }

  if (!process.env.VAPI_API_KEY) {
    return {
      synced: false,
      dryRun,
      assistantId,
      providerId: composed.providerId,
      expectedTools,
      attachedToolCount: null,
      warnings: [
        ...composed.warnings,
        "VAPI_API_KEY is not set, so the assistant cannot be read or written.",
      ],
    };
  }

  const warnings = [...composed.warnings];

  // Read first. Everything else on the model object has to survive.
  const current = (await getAssistant(assistantId)) as {
    model?: Record<string, unknown>;
    name?: string;
  };

  const currentModel = current.model ?? {};
  const toolIds = Array.isArray(currentModel.toolIds)
    ? (currentModel.toolIds as unknown[])
    : [];

  // Keep any non-system messages the assistant carries, and replace only the
  // system one. Vapi assistants normally hold a single system message, but
  // discarding anything else would be an unpleasant surprise.
  const existingMessages = Array.isArray(currentModel.messages)
    ? (currentModel.messages as Array<{ role?: string }>)
    : [];
  const nonSystem = existingMessages.filter((m) => m?.role !== "system");

  const payload = {
    model: {
      ...currentModel,
      messages: [
        { role: "system", content: composed.prompt },
        ...nonSystem,
      ],
    },
  };

  if (toolIds.length !== expectedTools.length) {
    warnings.push(
      `Vapi has ${toolIds.length} tool(s) attached but this organization's ` +
        `capabilities call for ${expectedTools.length} ` +
        `(${expectedTools.join(", ")}). Tools are managed in the Vapi console; ` +
        "this sync does not touch them."
    );
  }

  if (dryRun) {
    return {
      synced: false,
      dryRun: true,
      assistantId,
      providerId: composed.providerId,
      expectedTools,
      attachedToolCount: toolIds.length,
      payload,
      warnings,
    };
  }

  await updateAssistant(assistantId, payload);

  return {
    synced: true,
    dryRun: false,
    assistantId,
    providerId: composed.providerId,
    expectedTools,
    attachedToolCount: toolIds.length,
    payload,
    warnings,
  };
}
