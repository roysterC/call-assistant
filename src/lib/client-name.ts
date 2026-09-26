/**
 * Clients' names, split for the desk's client list and searched from one box.
 *
 * Every channel knows a client by one string: the voice agent hears "Siobhan
 * Kelly", WhatsApp has a profile name, the desk used to type one field. The
 * client list sorts on first and last name separately, so the full name is
 * split here — once, in one place — rather than by each screen that shows it.
 */

export interface NameParts {
  firstName: string | null;
  lastName: string | null;
}

function tidy(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * First word is the first name, everything after it the last name.
 *
 * Wrong for a two-word first name ("Mary Ann Smith" gives last name "Ann
 * Smith"), right for a multi-word surname ("Jo de Souza"). Surnames with
 * particles are the commoner case on a UK salon's books, and the desk can
 * correct either on the client's record.
 */
export function splitName(full: string | null | undefined): NameParts {
  const name = tidy(full);
  if (!name) return { firstName: null, lastName: null };
  const space = name.indexOf(" ");
  if (space === -1) return { firstName: name, lastName: null };
  return { firstName: name.slice(0, space), lastName: name.slice(space + 1) };
}

/** The display name for a client entered as two fields. */
export function joinName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string | null {
  const joined = [tidy(firstName), tidy(lastName)].filter(Boolean).join(" ");
  return joined || null;
}

/**
 * What the one search box was given.
 *
 * - digits (with the usual phone punctuation) search the number, so "07700
 *   900" finds +447700900123;
 * - anything with an @ searches the email;
 * - everything else is a name, where a space separates first from last:
 *   "sio kel" means a first name starting "sio" and a last name starting
 *   "kel".
 */
export type ClientQuery =
  | { kind: "all" }
  | { kind: "phone"; digits: string }
  | { kind: "email"; text: string }
  | { kind: "name"; first: string; rest: string | null; whole: string };

export function parseClientQuery(raw: string | null | undefined): ClientQuery {
  const q = tidy(raw);
  if (!q) return { kind: "all" };

  if (q.includes("@")) return { kind: "email", text: q.toLowerCase() };

  if (/^[+\d][\d\s()-]*$/.test(q)) {
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) {
      // Numbers are stored E.164 (+447700900123) but typed the UK way. A
      // leading 0 is the trunk prefix standing in for the 44, so swap it and
      // the typed digits line up with the stored ones.
      return {
        kind: "phone",
        digits: digits.startsWith("0") ? `44${digits.slice(1)}` : digits,
      };
    }
  }

  const space = q.indexOf(" ");
  if (space === -1) return { kind: "name", first: q, rest: null, whole: q };
  return {
    kind: "name",
    first: q.slice(0, space),
    rest: q.slice(space + 1),
    whole: q,
  };
}

/**
 * Whether two spoken names are plausibly the same person: the same first
 * name, and the same surname where both have one. Case, accents and
 * punctuation are ignored, because both sides came through a transcriber.
 *
 * Used to tell a client ringing about their own booking from someone ringing
 * about theirs, so it errs towards "no": "Sarah" matches "Sarah Friend", but
 * "Olivia Hart" does not, and nor does "Sara".
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const words = (s: string | null | undefined) =>
    (s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, " ")
      .replace(/['-]/g, "")
      .split(/\s+/)
      .filter(Boolean);
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length || x[0] !== y[0]) return false;
  if (x.length > 1 && y.length > 1) return x.slice(1).join(" ") === y.slice(1).join(" ");
  return true;
}
