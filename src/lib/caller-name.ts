/**
 * Caller name normalisation.
 *
 * A name is the least reliable field in the whole call. It arrives spoken and
 * transcribed: one or two words, a proper noun the speech model has probably
 * never seen, with no surrounding sentence to disambiguate it. On a bad line
 * it arrives as nothing at all.
 *
 * The agent used to be allowed to book without one — `customerName` was an
 * optional tool parameter and the handler stored `name: customerName || null`.
 * So a transcription miss became a confirmed appointment with nobody's name
 * against it, and because the model had asked for a name it thanked the caller
 * for one it had never received.
 *
 * Making the parameter required moves that failure rather than removing it: a
 * model that must supply a name and does not have one will invent a plausible
 * filler instead — "Unknown", "Customer", "the caller". This module exists so
 * that "required" means a real name, refusing the fillers as firmly as it
 * refuses a blank, and handing the agent back an instruction it can act on.
 */

export type CallerNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/** Longest a name may be. Past this, a sentence has leaked into the field. */
const MAX_LENGTH = 80;
const MAX_WORDS = 6;

/**
 * What a model reaches for when it must produce a name and has not got one.
 * Matched against the whole string, lower-cased — a real caller is not called
 * any of these, and storing one is indistinguishable from storing nothing.
 */
const PLACEHOLDERS = new Set([
  "anon",
  "anonymous",
  "blank",
  "caller",
  "client",
  "customer",
  "empty",
  "guest",
  "inaudible",
  "n/a",
  "na",
  "new caller",
  "new client",
  "no idea",
  "no name",
  "none",
  "noname",
  "not given",
  "not provided",
  "not sure",
  "null",
  "someone",
  "somebody",
  "test",
  "tbc",
  "tbd",
  "unclear",
  "undefined",
  "unknown",
  "unknown caller",
  "unspecified",
  "user",
]);

/**
 * Lead-ins the caller says and the transcriber faithfully includes. The model
 * often passes the whole phrase through rather than the name inside it.
 * Ordered longest-first so "my name is" wins over "name is".
 */
const LEAD_INS = [
  "my name is",
  "my name's",
  "the name is",
  "the name's",
  "this is",
  "name is",
  "name's",
  "i am",
  "i'm",
  "im",
  "it is",
  "it's",
  "its",
  "call me",
  "yeah",
  "yes",
  "hi",
  "hello",
];

function stripLeadIn(value: string): string {
  let out = value;
  // Repeated, because "hi it's Sarah" carries two of them.
  for (let pass = 0; pass < 3; pass++) {
    const lower = out.toLowerCase();
    const hit = LEAD_INS.find(
      (p) => lower === p || lower.startsWith(`${p} `) || lower.startsWith(`${p},`)
    );
    if (!hit) break;
    out = out.slice(hit.length).replace(/^[\s,]+/, "");
  }
  return out;
}

/**
 * Reassemble a name the caller spelled out.
 *
 * The prompt asks them to spell it when the first attempt fails, so
 * "S-A-R-A-H" and "S A R A H" both turn up here. Only a run made entirely of
 * single letters is joined; anything mixed is left alone, because "J Smith" is
 * a name and not a spelling.
 *
 * A caller who spells both names runs them into one word. The agent reads the
 * name back before it books, which is where that gets caught.
 */
function joinSpelledLetters(value: string): string {
  const tokens = value.split(/[\s-]+/).filter(Boolean);
  if (tokens.length < 3) return value;
  if (!tokens.every((t) => /^[a-z]$/i.test(t))) return value;
  // Cased here rather than left to `capitalise`, which deliberately leaves a
  // value that already carries a capital alone — "S-A-R-A-H" carries five.
  const joined = tokens.join("");
  return joined[0].toUpperCase() + joined.slice(1).toLowerCase();
}

/**
 * Capitalise a name the transcriber handed over in lower case.
 *
 * AssemblyAI in `min_latency` mode returns unformatted text, so "sarah jones"
 * is the normal shape rather than the exception. Only touched when there is no
 * capital anywhere — a name that arrived cased is left as the caller's own,
 * so "McDonald" and "van Dijk" survive.
 */
function capitalise(value: string): string {
  if (/[A-Z]/.test(value)) return value;
  return value.replace(/(^|[\s'’-])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Normalise a spoken name, or say why it cannot be used.
 *
 * The `reason` is read out to nobody — it goes back to the model as part of a
 * tool failure, so it is written as an instruction rather than an error.
 */
export function normaliseCallerName(
  input: string | undefined | null
): CallerNameResult {
  const collapsed = (input ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return { ok: false, reason: "No name was given." };
  }

  let value = stripLeadIn(collapsed);
  // Punctuation the transcriber adds around the edges. Only the edges: the
  // apostrophe in O'Brien and the hyphen in Anne-Marie are part of the name.
  // Digits are deliberately left in place so that a phone number arriving in
  // this field is refused below rather than quietly trimmed into a name.
  value = value.replace(/^[\s\p{P}]+/u, "").replace(/[\s\p{P}]+$/u, "");
  value = joinSpelledLetters(value);

  if (!value) {
    return { ok: false, reason: "No name was given." };
  }

  // "the caller" and "the customer" are the same refusal as "caller", so the
  // article is dropped rather than doubling every entry in the list.
  const bare = value.toLowerCase().replace(/^the /, "");
  if (PLACEHOLDERS.has(bare)) {
    return {
      ok: false,
      reason: `"${collapsed}" is not a name.`,
    };
  }

  if (/\d/.test(value)) {
    return { ok: false, reason: "That was digits rather than a name." };
  }

  const letters = value.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) {
    return { ok: false, reason: "That was too short to be a name." };
  }

  if (value.length > MAX_LENGTH || value.split(" ").length > MAX_WORDS) {
    return {
      ok: false,
      reason: "That was a sentence rather than a name.",
    };
  }

  return { ok: true, name: capitalise(value) };
}

/**
 * The failure a booking tool hands back when the name is missing or unusable.
 *
 * One message, so `book_appointment` and `book_callback` cannot drift into
 * telling the model two different things. It names the spelling ladder
 * explicitly: without it the model tends to ask the same open question again
 * and get the same unusable answer.
 */
export function nameRequiredMessage(reason: string): string {
  return (
    `${reason} You cannot book without the caller's name. Ask for it again — ` +
    "and if you still do not catch it, ask them to spell it out letter by " +
    "letter. Do not guess it, do not use the number instead, and do not " +
    "thank them for a name you have not heard."
  );
}
