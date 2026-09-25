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
  /**
   * List price in pence, or null when the salon has not set one.
   *
   * A guide rather than a fixed figure: hair pricing moves with length and
   * thickness, which is why the agent is told not to quote. The desk records
   * what was actually taken on the appointment; this is what it starts from.
   */
  priceMinor: number | null;
}

export interface Stylist {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  /** Google Calendar id. Only needed when the salon's diary is Google. */
  googleCalendarId?: string;
  /**
   * Whether the stylist can be booked into at all. Set from the salon's diary
   * mode when the config is read (getSalonConfig): everyone on our own diary,
   * only stylists with a calendar on Google's. Unset means the Google rule,
   * which is what every stylist parsed without a diary mode gets.
   */
  bookable?: boolean;
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

    // Null and zero are different facts: "not priced yet" must not total as
    // a free service, so only a real number becomes a price.
    // Number(null) is 0, so null and "" are caught before the conversion
    // rather than coming out as a free service.
    const priceRaw =
      e.priceMinor === null || e.priceMinor === "" ? NaN : Number(e.priceMinor);
    const priceMinor =
      Number.isFinite(priceRaw) && priceRaw >= 0 ? Math.round(priceRaw) : null;

    seen.add(key);
    out.push({
      name,
      durationMinutes: Math.round(durationMinutes),
      requiresPatchTest: Boolean(e.requiresPatchTest),
      bufferMinutes: Math.round(bufferMinutes),
      priceMinor,
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
 * Several services booked back to back as one appointment.
 *
 * Shaped like a `SalonService` so that every call site reading `name`,
 * `durationMinutes` or `requiresPatchTest` keeps working unchanged — the
 * combination is just a service whose length is the sum of its parts.
 */
export interface CombinedService extends SalonService {
  parts: SalonService[];
}

/** How a combined service reads in the diary, and how it is split back up. */
export const SERVICE_JOINER = " + ";

/**
 * Words that turn up around a service name and are not themselves a service.
 *
 * Deliberately generous. A false "I did not understand that" sends the agent
 * off asking a pointless question mid-call — which is exactly what the first
 * version of this code did to a caller who asked for a cut and finish. A
 * genuine second service is a noun phrase; a stray "for me" is not worth
 * interrogating.
 */
const SERVICE_FILLER = new Set([
  "a", "an", "and", "the", "of", "for", "with", "please", "my", "some",
  "also", "plus", "just", "only", "want", "wants", "wanted", "would", "like",
  "need", "needs", "get", "getting", "have", "having", "do", "doing", "book",
  "booking", "appointment", "appointments", "session", "too", "as", "well",
  "me", "i", "im", "thanks", "thank", "you", "to", "in", "on", "at", "it",
  "that", "this", "then", "or", "can", "could",
]);

/** Split a stored `serviceText` back into the names that made it. */
export function splitServiceText(text: string): string[] {
  return String(text ?? "")
    .split(SERVICE_JOINER)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve spoken text to every service it names.
 *
 * A caller who asks for "a haircut and to dye my hair" wants two things, and
 * booking only one of them is how a stylist ends up with a two hour slot for
 * two and a half hours of work.
 *
 * Done by scanning the phrase for service names, longest first, blanking each
 * as it is found — not by splitting on "and" and matching the pieces. The
 * splitting version shipped and was wrong within the hour: `matchService` is
 * fuzzy, so "finish" alone resolves to "Cut and finish" while "cut" stays
 * ambiguous, and the phrase "cut and finish" therefore came apart into one
 * match and one complaint. A live caller was asked whether they wanted "a cut
 * and finish, or just a cut". Scanning for whole names sidesteps the question:
 * a service name either appears in the phrase or it does not.
 *
 * Unmatched words are returned rather than dropped, so the caller can be asked
 * about the half that was not understood.
 */
export function matchServices(
  spoken: string | undefined,
  services: SalonService[]
): { matched: SalonService[]; unmatched: string[] } {
  const raw = (spoken ?? "").trim();
  if (!raw) return { matched: [], unmatched: [] };

  // Longest name first, so "Cut and finish" claims its words before "Gents
  // cut" can match the "cut" sitting inside them.
  const byLength = [...services]
    .map((s) => ({ service: s, key: normalise(s.name) }))
    .filter((e) => e.key.length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  // Padded at both ends so ` ${name} ` gives whole-word matching without a
  // regex — "cut" must not match inside "haircut".
  let remaining = ` ${normalise(raw)} `;
  const matched: SalonService[] = [];

  for (const { service, key } of byLength) {
    let at = remaining.indexOf(` ${key} `);
    if (at === -1) continue;
    matched.push(service);
    // Blank every occurrence, so a service said twice is booked once and its
    // words cannot be read back as something left over.
    while (at !== -1) {
      remaining =
        remaining.slice(0, at + 1) + remaining.slice(at + 1 + key.length);
      at = remaining.indexOf(` ${key} `);
    }
  }

  if (matched.length === 0) {
    // Nothing named outright. Fall back to the fuzzy single-service match, so
    // "highlights" and the like behave exactly as they always did.
    const fuzzy = matchService(raw, services);
    return fuzzy
      ? { matched: [fuzzy], unmatched: [] }
      : { matched: [], unmatched: [raw] };
  }

  const leftover = normalise(remaining)
    .split(" ")
    .filter((t) => t && !SERVICE_FILLER.has(t));

  return {
    matched,
    unmatched: leftover.length > 0 ? [leftover.join(" ")] : [],
  };
}

/** Fold several services into the one appointment they will be booked as. */
export function combineServices(parts: SalonService[]): CombinedService {
  if (parts.length === 1) return { ...parts[0], parts: [parts[0]] };

  // Longest first, so the diary label leads with the main job and the colour
  // coding follows the work that fills most of the slot.
  const ordered = [...parts].sort(
    (a, b) => b.durationMinutes - a.durationMinutes
  );

  return {
    name: ordered.map((p) => p.name).join(SERVICE_JOINER),
    // Back to back in one slot, so the times add up.
    durationMinutes: ordered.reduce((n, p) => n + p.durationMinutes, 0),
    // One tidy-up at the end of the appointment, not one per service.
    bufferMinutes: Math.max(...ordered.map((p) => p.bufferMinutes)),
    // Any colour in the mix brings its patch-test rule with it.
    requiresPatchTest: ordered.some((p) => p.requiresPatchTest),
    // A total is only a total when every part of it has a price. Adding up
    // the ones that do would quote the caller less than the appointment costs.
    priceMinor: ordered.every((p) => p.priceMinor !== null)
      ? ordered.reduce((n, p) => n + (p.priceMinor ?? 0), 0)
      : null,
    parts: ordered,
  };
}

/**
 * Services picked from the list at the desk, as the one appointment they make.
 *
 * Each must be on the list exactly: fuzzy matching is for what a caller says,
 * not for a value chosen from a list, where a near miss means the list and
 * the catalogue have drifted and guessing would book the wrong length.
 */
export function servicesPicked(
  names: string[],
  services: SalonService[]
): { ok: true; service: CombinedService } | { ok: false; missing: string } {
  const parts: SalonService[] = [];
  for (const name of names) {
    const found = services.find(
      (s) => s.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (!found) return { ok: false, missing: name };
    parts.push(found);
  }
  if (parts.length === 0) return { ok: false, missing: "" };
  return { ok: true, service: combineServices(parts) };
}

/**
 * Resolve spoken text to the single service an appointment will be booked as,
 * or say what could not be understood.
 *
 * Shared by availability, booking and rescheduling so the three cannot come to
 * different conclusions about how long the same request takes.
 */
export function resolveBookedService(
  spoken: string | undefined,
  services: SalonService[]
):
  | { ok: true; service: CombinedService }
  | { ok: false; matched: SalonService[]; unmatched: string[] } {
  const { matched, unmatched } = matchServices(spoken, services);
  if (matched.length === 0 || unmatched.length > 0) {
    return { ok: false, matched, unmatched };
  }
  return { ok: true, service: combineServices(matched) };
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

/** Whether a stylist can be booked into. See `Stylist.bookable`. */
export function isBookable(stylist: Stylist): boolean {
  return stylist.bookable ?? Boolean(stylist.googleCalendarId);
}

/** Stylists who can perform `service` and are bookable at all. */
export function stylistsForService(
  service: SalonService,
  stylists: Stylist[]
): Stylist[] {
  return stylists.filter((s) => {
    if (!isBookable(s)) return false;
    if (s.services.length === 0) return true; // empty means "all services"
    return s.services.some(
      (name) => normalise(name) === normalise(service.name)
    );
  });
}

/**
 * Drop working days the salon is shut on.
 *
 * Booking already refuses a closed day, so this changes nothing about what
 * can be booked. What it changes is what the agent *says*: the team
 * description is generated from these lists, and "Jo works Tue, Wed, Thu" on
 * a salon that shuts Thursdays is a caller being told to ring back for a day
 * that does not exist.
 *
 * A stylist whose every day is closed keeps their list untouched. Pruning it
 * to [] would read as "any day the salon is open", which is the opposite of
 * what the data says — and turning "works none of our open days" into "works
 * all of them" is the one direction that must never happen silently.
 */
export function constrainWorkingDays(
  stylists: Stylist[],
  openDays: number[]
): Stylist[] {
  // Hours unconfigured — constraining against nothing would close everyone.
  if (openDays.length === 0) return stylists;

  return stylists.map((s) => {
    if (s.workingDays.length === 0) return s; // already "any open day"
    const kept = s.workingDays.filter((d) => openDays.includes(d));
    if (kept.length === 0 || kept.length === s.workingDays.length) return s;
    return { ...s, workingDays: kept };
  });
}

export function stylistWorksOn(stylist: Stylist, weekday: number): boolean {
  if (stylist.workingDays.length === 0) return true;
  return stylist.workingDays.includes(weekday);
}

/**
 * Whether anyone who performs `service` is rostered on `weekday` at all.
 *
 * Distinct from "nothing free": a day with no eligible stylist is not busy,
 * it is unstaffed for that service, and it will be unstaffed next week too.
 * A caller told Saturday is full rings back about the Saturday after and
 * hears the same thing forever, so the agent has to be able to tell the two
 * apart. Ignores the diary entirely — this is a roster question.
 *
 * Says nothing about whether the salon is open that day; check the hours
 * first, because shut beats unstaffed as an explanation.
 */
export function serviceIsStaffedOn(
  service: SalonService,
  stylists: Stylist[],
  weekday: number
): boolean {
  return stylistsForService(service, stylists).some((s) =>
    stylistWorksOn(s, weekday)
  );
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
 * who cannot be booked (on a Google diary, one with no calendar) can still be
 * asked for by name, and the agent needs to know
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

  const bookable = stylists.filter(isBookable);
  const unbookable = stylists.filter((s) => !isBookable(s));

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

/** Whether a stylist performs a given service. Empty list means all of them. */
export function stylistDoesService(
  stylist: Stylist,
  service: SalonService
): boolean {
  if (stylist.services.length === 0) return true;
  return stylist.services.some(
    (name) => normalise(name) === normalise(service.name)
  );
}
