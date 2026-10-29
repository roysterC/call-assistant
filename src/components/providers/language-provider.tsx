"use client";

/**
 * The language the CRM is shown in (src/lib/i18n), for every screen, and the
 * clock its times are read on (12- or 24-hour), which works the same way.
 *
 * It starts from the kikai-lang cookie, which the server read to render the
 * page, so there is no flash of English. Once the signed-in person is known,
 * their own saved choice wins; a choice made on the login page before they
 * had one is saved to them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";
import {
  CLOCK_COOKIE,
  DEFAULT_LANG,
  INTL_LOCALE,
  LANG_COOKIE,
  defaultClock,
  isClock,
  isLang,
  translate,
  type Clock,
  type Lang,
  type Translate,
} from "@/lib/i18n";

interface LanguageState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** The clock in use: the person's choice, else their language's. */
  clock: Clock;
  setClock: (clock: Clock) => void;
}

const LanguageContext = createContext<LanguageState>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  clock: defaultClock(DEFAULT_LANG),
  setClock: () => {},
});

function save(change: { language: Lang } | { clock: Clock }) {
  return apiFetch("/api/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  }).catch(() => {});
}

const YEAR = 31536000;

export function LanguageProvider({
  initial,
  initialClock = null,
  children,
}: {
  initial: Lang;
  /** The clock chosen on this device (the kikai-clock cookie), if any. */
  initialClock?: Clock | null;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initial);
  const [chosenClock, setChosenClock] = useState<Clock | null>(initialClock);
  const me = useMe();

  const apply = useCallback((next: Lang) => {
    setLangState(next);
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${YEAR}; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  const saved = me?.language;
  const signedIn = Boolean(me);
  useEffect(() => {
    if (!signedIn) return;
    if (isLang(saved)) {
      if (saved !== lang) apply(saved);
    } else if (lang !== DEFAULT_LANG) {
      void save({ language: lang });
    }
    // Only when who is signed in, or their saved choice, changes: the
    // language changing here is this person choosing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, saved]);

  const applyClock = useCallback((next: Clock) => {
    setChosenClock(next);
    document.cookie = `${CLOCK_COOKIE}=${next}; path=/; max-age=${YEAR}; samesite=lax`;
  }, []);

  // The clock follows the same rule: theirs once signed in, and a choice
  // made on this device before they had one is saved to them.
  const savedClock = me?.clock;
  useEffect(() => {
    if (!signedIn) return;
    if (isClock(savedClock)) {
      if (savedClock !== chosenClock) applyClock(savedClock);
    } else if (chosenClock) {
      void save({ clock: chosenClock });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, savedClock]);

  const setLang = useCallback(
    (next: Lang) => {
      apply(next);
      if (signedIn) void save({ language: next });
    },
    [apply, signedIn]
  );

  const setClock = useCallback(
    (next: Clock) => {
      applyClock(next);
      if (signedIn) void save({ clock: next });
    },
    [applyClock, signedIn]
  );

  const clock = chosenClock ?? defaultClock(lang);
  const value = useMemo(() => ({ lang, setLang, clock, setClock }), [lang, setLang, clock, setClock]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** The chosen language and the means to change it. */
export function useLanguage(): LanguageState {
  return useContext(LanguageContext);
}

/**
 * `t` for this screen's words, `locale` for its dates and numbers
 * (toLocaleDateString(locale, …)), and `clock` for its times (clockTime).
 */
export function useT(): { t: Translate; lang: Lang; locale: string; clock: Clock } {
  const { lang, clock } = useContext(LanguageContext);
  return useMemo(
    () => ({ t: (key, vars) => translate(lang, key, vars), lang, locale: INTL_LOCALE[lang], clock }),
    [lang, clock]
  );
}
