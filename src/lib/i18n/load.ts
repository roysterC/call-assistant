/**
 * Each language's phrases, for the server to render a page in (the root
 * layout hands the reader's to the browser) or to write an email in. Not
 * for the browser to import: that would send every language to everyone.
 *
 * A language missing a phrase gets the English one, so a new language can be
 * added a part at a time and nothing ever shows a bare key.
 */

import type { Lang, Messages } from ".";
import en from "./messages/en.json";
import vi from "./messages/vi.json";

/** Every language's file. A language added to LANGUAGE_INFO without one fails the type check here. */
const FILES: Record<Lang, unknown> = { en, vi };

function merged(base: unknown, over: unknown): unknown {
  if (typeof base !== "object" || base === null) return typeof over === "string" && over ? over : base;
  const out: Record<string, unknown> = {};
  const o = (typeof over === "object" && over !== null ? over : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) out[k] = merged(v, o[k]);
  return out;
}

const cache = new Map<Lang, Messages>();

/** `lang`'s phrases, with English wherever it has none. */
export function messagesFor(lang: Lang): Messages {
  let m = cache.get(lang);
  if (!m) {
    m = (lang === "en" ? en : merged(en, FILES[lang])) as Messages;
    cache.set(lang, m);
  }
  return m;
}
