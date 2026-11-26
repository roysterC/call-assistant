/**
 * "Accented English": a test language, for development only. Every phrase is
 * English with its letters accented and padded a third longer, in brackets:
 * "Clients" reads "[Çļîéñţš ···]". So on a page in it,
 *
 *  - plain English is a word typed into the screen instead of taken from the
 *    phrase files: it will stay English in every language;
 *  - a phrase cut short, or a layout that breaks, is what a longer language
 *    (German runs a third longer than English) will do.
 *
 * Switched on by the kikai-lang cookie set to "pseudo", and only while
 * developing (src/app/layout.tsx); never offered in the language switch.
 * Blanks, plurals and the like are kept as they are, so every phrase still
 * fills in.
 */

import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";
import type { Messages } from ".";

export const PSEUDO = "pseudo";

const ACCENTS: Record<string, string> = {
  a: "á", b: "ƀ", c: "ç", d: "đ", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
  n: "ñ", o: "ö", p: "þ", r: "ŕ", s: "š", t: "ţ", u: "ü", w: "ŵ", y: "ý", z: "ž",
  A: "Á", B: "Ɓ", C: "Ç", D: "Đ", E: "É", G: "Ĝ", H: "Ĥ", I: "Î", J: "Ĵ", K: "Ķ", L: "Ļ", N: "Ñ", O: "Ö",
  P: "Þ", R: "Ŕ", S: "Š", T: "Ţ", U: "Ü", W: "Ŵ", Y: "Ý", Z: "Ž",
};

function accent(text: string): string {
  return [...text].map((ch) => ACCENTS[ch] ?? ch).join("");
}

function walk(els: MessageFormatElement[]): void {
  for (const el of els) {
    if (el.type === TYPE.literal) el.value = accent(el.value);
    else if (el.type === TYPE.plural || el.type === TYPE.select) for (const o of Object.values(el.options)) walk(o.value);
    else if (el.type === TYPE.tag) walk(el.children);
  }
}

/** One phrase in accented English. */
export function pseudoPhrase(message: string): string {
  if (!message) return message;
  const ast = parse(message, { ignoreTag: true });
  walk(ast);
  const padding = "·".repeat(Math.max(1, Math.round(message.length / 3)));
  return `[${printAST(ast)} ${padding}]`;
}

/** Every phrase in accented English. */
export function pseudoMessages(node: Messages): Messages {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = typeof v === "string" ? pseudoPhrase(v) : pseudoMessages(v as unknown as Messages);
  }
  return out as unknown as Messages;
}
