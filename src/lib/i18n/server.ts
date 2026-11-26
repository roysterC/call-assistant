/**
 * Phrases outside a page: the emails a person is sent in their own language
 * (password reset, confirming an email, invitations). Pages get theirs from
 * the language provider instead.
 */

import { createTranslator } from "next-intl";
import { blanks, type Lang, type MessageKey, type Vars } from ".";
import { messagesFor } from "./load";

type Translator = { (key: string, values?: Vars): string; raw: (key: string) => unknown };
const translators = new Map<Lang, Translator>();

function translatorFor(lang: Lang): Translator {
  let t = translators.get(lang);
  if (!t) {
    const made = createTranslator({
      locale: lang,
      messages: messagesFor(lang) as never,
      // A phrase that cannot be filled in (a blank given nothing) is shown as
      // written, blanks and all, rather than as its key.
      onError: () => {},
      getMessageFallback: ({ key, namespace }) => {
        const path = (namespace ? `${namespace}.${key}` : key).split(".");
        const raw = path.reduce<unknown>((node, p) => (node as Record<string, unknown> | undefined)?.[p], messagesFor(lang));
        return typeof raw === "string" ? raw : path.join(".");
      },
    });
    t = made as unknown as Translator;
    translators.set(lang, t);
  }
  return t;
}

/** A phrase in `lang`, with its {blanks} filled in. */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const t = translatorFor(lang);
  const raw = t.raw(key);
  return t(key, blanks(typeof raw === "string" ? raw : "", vars));
}
