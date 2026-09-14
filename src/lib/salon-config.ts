/**
 * Salon services and stylists, parsed from `OrganizationSettings`.
 *
 * Stored as JSON rather than tables. One salon does not justify relational
 * integrity plus two CRUD screens, and `teamMembers` already establishes this
 * pattern in the settings UI. These become real tables the day we support
 * several salons with overlapping service catalogues.
 *
 * Service duration is the load-bearing field: it decides how much of a
 * stylist's day to block. Booking a three-hour balayage into a 45-minute gap
 * is the failure mode that matters, so duration comes from here and never
 * from the language model.
 */

export interface SalonService {
  name: string;
  durationMinutes: number;
  /** Colour work needs a skin test 48h ahead for clients we have not seen. */
  requiresPatchTest: boolean;
  /** Tidy-up time booked after the appointment; excluded from the slot. */
  bufferMinutes: number;
}

export interface Stylist {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  /** Google Calendar id. Without one the stylist cannot be booked. */
  googleCalendarId?: string;
  /** 0 = Sunday ... 6 = Saturday. Empty means "any day the salon is open". */
  workingDays: number[];
  /** Service names this stylist performs. Empty means "all services". */
  services: string[];
}

const DEFAULT_BUFFER_MINUTES = 0;

// -------------------------------------------------------------------------
// Parsing
// -------------------------------------------------------------------------

/**
 * Both parsers drop malformed entries rather than throwing. A single bad row
 * in settings must not take the phone line down; a missing service simply
 * cannot be booked, which the agent handles by taking a message.
 */
export function parseServices(raw: unknown): SalonService[] {
  if (!Array.isArray(raw)) return [];
  const out: SalonService[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const name = String(e.name ?? "").trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    const durationMinutes = Number(e.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) continue;
    // A single appointment longer than a working day is a data-entry error.
    if (durationMinutes > 12 * 60) continue;

    const bufferRaw = Number(e.bufferMinutes);
    const bufferMinutes =
      Number.isFinite(bufferRaw) && bufferRaw >= 0
        ? bufferRaw
        : DEFAULT_BUFFER_MINUTES;

    seen.add(key);
    out.push({
      name,
      durationMinutes: Math.round(durationMinutes),
      requiresPatchTest: Boolean(e.requiresPatchTest),
      bufferMinutes: Math.round(bufferMinutes),
    });
  }

  return out;
}

export function parseStylists(raw: unknown): Stylist[] {
  if (!Array.isArray(raw)) return [];
  const out: Stylist[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const name = String(e.name ?? "").trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const workingDays = Array.isArray(e.workingDays)
      ? Array.from(
          new Set(
            e.workingDays
              .map((d) => Number(d))
              .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          )
        ).sort()
      : [];

    const services = Array.isArray(e.services)
      ? e.services.map((s) => String(s).trim()).filter(Boolean)
      : [];

    const googleCalendarId = String(e.googleCalendarId ?? "").trim();

    out.push({
      name,
      email: String(e.email ?? "").trim() || undefined,
      phone: String(e.phone ?? "").trim() || undefined,
      role: String(e.role ?? "").trim() || undefined,
      googleCalendarId: googleCalendarId || undefined,
      workingDays,
      services,
    });
  }

  return out;
}

// -------------------------------------------------------------------------
// Matching
//
// The agent hears "a half head of highlights with Jo" down a phone line, so
// these resolve loosely-spoken text against configured names. Deliberately
// conservative: an ambiguous match returns null and the agent asks rather
// than guessing, because guessing wrong books the wrong duration.
// -------------------------------------------------------------------------

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "for", "with", "please", "my", "some",
]);

function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

/**
 * Resolve spoken text to a configured service.
 *
 * Exact match, then containment either way, then best token overlap — but a
 * token-overlap win must be unique and cover MORE than half the service's own
 * tokens.
 *
 * Strictly more than half, not at least: "beard trim" shares one word with
 * "Fringe trim", which is exactly half of it, and that was enough to book
 * someone a fifteen-minute fringe trim when they asked for a beard. One word
 * in common — and it is always a common word, "cut", "trim", "colour" — is
 * not evidence. Returning null makes the agent ask, which costs a sentence;
 * guessing costs the wrong appointment at the wrong length.
 */
export function matchService(
  spoken: string | undefined,
  services: SalonService[]
): SalonService | null {
  if (!spoken) return null;
  const want = normalise(spoken);
  if (!want) return null;

  const exact = services.find((s) => normalise(s.name) === want);
  if (exact) return exact;

  const contained = services.filter((s) => {
    const n = normalise(s.name);
    return n.includes(want) || want.includes(n);
  });
  if (contained.length === 1) return contained[0];

  const wantTokens = new Set(tokens(spoken));
  let best: { service: SalonService; score: number } | null = null;
  let tied = false;

  for (const s of services) {
    const serviceTokens = tokens(s.name);
    if (serviceTokens.length === 0) continue;
    const hits = serviceTokens.filter((t) => wantTokens.has(t)).length;
    if (hits === 0) continue;
    const score = hits / serviceTokens.length;
    if (!best || score > best.score) {
      best = { service: s, score };
      tied = false;
    } else if (best && score === best.score) {
      tied = true;
    }
  }

  if (!best || tied || best.score <= 0.5) return null;
  return best.service;
}

/** Resolve a spoken first name to a configured stylist. */
export function matchStylist(
  spoken: string | undefined,
  stylists: Stylist[]
): Stylist | null {
  if (!spoken) return null;
  const want = normalise(spoken);
  if (!want) return null;

  const exact = stylists.find((s) => normalise(s.name) === want);
  if (exact) return exact;

  // First-name match, which is how callers actually refer to stylists.
  const byFirstName = stylists.filter(
    (s) => normalise(s.name).split(" ")[0] === want.split(" ")[0]
  );
  if (byFirstName.length === 1) return byFirstName[0];

  return null;
}

/** Stylists who can perform `service` and are bookable at all. */
export function stylistsForService(
  service: SalonService,
  stylists: Stylist[]
): Stylist[] {
  return stylists.filter((s) => {
    if (!s.googleCalendarId) return false; // not bookable without a calendar
    if (s.services.length === 0) return true; // empty means "all services"
    return s.services.some(
      (name) => normalise(name) === normalise(service.name)
    );
  });
}

export function stylistWorksOn(stylist: Stylist, weekday: number): boolean {
  if (stylist.workingDays.length === 0) return true;
  return stylist.workingDays.includes(weekday);
}

/** Service catalogue for the voice prompt, generated from the same config. */
export function describeServicesForPrompt(services: SalonService[]): string {
  if (services.length === 0) return "No services are configured.";
  return services
    .map((s) => {
      const hours = Math.floor(s.durationMinutes / 60);
      const mins = s.durationMinutes % 60;
      const dur =
        hours > 0
          ? mins > 0
            ? `${hours}h ${mins}m`
            : `${hours}h`
          : `${mins} minutes`;
      const patch = s.requiresPatchTest ? " (patch test for new clients)" : "";
      return `- ${s.name} — about ${dur}${patch}`;
    })
    .join("\n");
}

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The team, for the voice prompt.
 *
 * Generated rather than written by hand, so removing someone in settings
 * removes them from what the agent says. A stylist who has left but is still
 * named in a hand-written prompt gets offered to callers, and the booking then
 * fails — which is how a roster change turns into a bad phone call weeks later.
 *
 * Bookable and unbookable are listed separately and deliberately. A stylist
 * with no calendar can still be asked for by name, and the agent needs to know
 * that taking a message is the right answer rather than discovering mid-call
 * that it cannot book them.
 */
export function describeTeamForPrompt(
  stylists: Stylist[],
  services: SalonService[]
): string {
  if (stylists.length === 0) return "No stylists are configured.";

  const describeDays = (s: Stylist) =>
    s.workingDays.length === 0
      ? "any day the salon is open"
      : s.workingDays.map((d) => DAY_NAMES_SHORT[d]).join(", ");

  const describeServices = (s: Stylist) => {
    if (s.services.length === 0) return "everything";
    // Only name services that still exist — a stylist listed against a
    // service that was deleted would have the agent offering it.
    const live = s.services.filter((name) =>
      services.some((sv) => sv.name.toLowerCase() === name.toLowerCase())
    );
    return live.length > 0 ? live.join(", ") : "everything";
  };

  const bookable = stylists.filter((s) => s.googleCalendarId);
  const unbookable = stylists.filter((s) => !s.googleCalendarId);

  const lines: string[] = [];

  for (const s of bookable) {
    const role = s.role ? ` — ${s.role}` : "";
    lines.push(
      `- **${s.name}**${role}. Works ${describeDays(s)}. Does ${describeServices(s)}.`
    );
  }

  if (unbookable.length > 0) {
    lines.push("");
    lines.push(
      `${unbookable.map((s) => s.name).join(", ")} also work here but cannot ` +
        "be booked over the phone. If a caller asks for one of them, take a " +
        "message and say the salon will ring back to arrange it."
    );
  }

  if (bookable.length === 0) {
    return (
      "Nobody can currently be booked by phone. Take the request and say the " +
      "salon will ring back to confirm."
    );
  }

  return lines.join("\n");
}
