/**
 * What a text costs, and keeping it cheap.
 *
 * Twilio bills per segment. A text written only in the GSM-7 alphabet (the
 * plain letters, digits and punctuation phones have always had) fits 160
 * characters in one segment, or 153 a segment once it runs to several. One
 * character outside it, a curly apostrophe pasted from Notes, a long dash, an
 * emoji, and the whole text goes as UCS-2 instead: 70 characters a segment,
 * 67 once split. A 150-character confirmation with a long dash in it went as
 * three segments; without, it is one.
 *
 * toGsm() swaps the usual offenders for their plain equivalents before a
 * text goes. Letters with accents GSM-7 has (é, è, ü, ñ, à...) are kept;
 * other accented letters lose the accent ("Zoë" goes as "Zoe"). Emoji are
 * dropped. Anything still outside the alphabet, a name in another script for
 * instance, is left alone: getting the name right is worth the cost.
 */

// GSM 03.38, the default alphabet (one unit each). ESC (0x1B) is left out:
// it only introduces the extension table.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
// The extension table: each costs two units (an escape, then the character).
const GSM_EXTENDED = "^{}\\[~]|€\f";

const BASIC = new Set(GSM_BASIC);
const EXTENDED = new Set(GSM_EXTENDED);

const isGsm = (ch: string) => BASIC.has(ch) || EXTENDED.has(ch);

/** Plain stand-ins for characters that would make a text UCS-2. */
const REPLACEMENTS: Record<string, string> = {
  "\u2014": "-", // em dash
  "\u2013": "-", // en dash
  "\u2012": "-", // figure dash
  "\u2015": "-", // horizontal bar
  "\u2010": "-", // hyphen
  "\u2011": "-", // non-breaking hyphen
  "\u2212": "-", // minus sign
  "\u2018": "'", // left single quote
  "\u2019": "'", // right single quote, the curly apostrophe
  "\u201A": "'", // low single quote
  "\u201B": "'", // reversed single quote
  "\u2032": "'", // prime
  "\u00B4": "'", // acute accent
  "`": "'",
  "\u201C": '"', // left double quote
  "\u201D": '"', // right double quote
  "\u201E": '"', // low double quote
  "\u2033": '"', // double prime
  "\u00AB": '"', // left guillemet
  "\u00BB": '"', // right guillemet
  "\u2026": "...", // ellipsis
  "\u2022": "-", // bullet
  "\u00B7": "-", // middle dot
  "\u00A0": " ", // no-break space
  "\u2007": " ", // figure space
  "\u2009": " ", // thin space
  "\u202F": " ", // narrow no-break space
  "\u200A": " ", // hair space
  "\t": " ",
  "\u2028": "\n", // line separator
  "\u2029": "\n", // paragraph separator
  "\u00D7": "x", // multiplication sign
};

// Zero-width spaces and joiners, word joiner, byte-order mark, variation
// selectors: invisible, and each would make the text UCS-2.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\uFE0E\uFE0F]/g;
// Pictographs, skin tones, flags (regional indicators) and keycaps.
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\u20E3]/gu;

/** The text with the usual non-GSM characters swapped for plain ones. */
export function toGsm(text: string): string {
  const swapped = Array.from(text.replace(INVISIBLE, "").replace(EMOJI, ""))
    .map((ch) => {
      if (isGsm(ch)) return ch;
      if (REPLACEMENTS[ch] !== undefined) return REPLACEMENTS[ch];
      // An accent GSM-7 lacks: try the bare letter.
      const bare = ch.normalize("NFD").replace(/\p{Mn}/gu, "");
      return bare && Array.from(bare).every(isGsm) ? bare : ch;
    })
    .join("");
  // Dropping an emoji can leave a double space or a space before a full stop.
  return swapped.replace(/ {2,}/g, " ").replace(/ +([.,!?])/g, "$1").trim();
}

export interface SmsSize {
  encoding: "GSM-7" | "UCS-2";
  /** Characters as the network counts them: extension characters are two. */
  length: number;
  segments: number;
}

/** How a text will be sent, and how many segments it will be billed as. */
export function smsSize(text: string): SmsSize {
  const chars = Array.from(text);
  if (chars.every(isGsm)) {
    const length = chars.reduce((n, ch) => n + (EXTENDED.has(ch) ? 2 : 1), 0);
    return { encoding: "GSM-7", length, segments: length <= 160 ? 1 : Math.ceil(length / 153) };
  }
  // UCS-2 counts UTF-16 code units: an emoji is two.
  const length = text.length;
  return { encoding: "UCS-2", length, segments: length <= 70 ? 1 : Math.ceil(length / 67) };
}
