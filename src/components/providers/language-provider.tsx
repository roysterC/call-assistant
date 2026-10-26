"use client";

/**
 * The language the CRM is shown in (src/lib/i18n), for every screen.
 *
 * It starts from the kikai-lang cookie, which the server read to render the
 * page, so there is no flash of English. Once the signed-in person is known,
 * their own saved choice wins; a choice made on the login page before they
 * had one is saved to them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";
import { DEFAULT_LANG, INTL_LOCALE, LANG_COOKIE, isLang, translate, type Lang, type Translate } from "@/lib/i18n";

interface LanguageState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageState>({ lang: DEFAULT_LANG, setLang: () => {} });

function save(lang: Lang) {
  return apiFetch("/api/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: lang }),
  }).catch(() => {});
}

export function LanguageProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const me = useMe();

  const apply = useCallback((next: Lang) => {
    setLangState(next);
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  const saved = me?.language;
  const signedIn = Boolean(me);
  useEffect(() => {
    if (!signedIn) return;
    if (isLang(saved)) {
      if (saved !== lang) apply(saved);
    } else if (lang !== DEFAULT_LANG) {
      void save(lang);
    }
    // Only when who is signed in, or their saved choice, changes: the
    // language changing here is this person choosing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, saved]);

  const setLang = useCallback(
    (next: Lang) => {
      apply(next);
      if (signedIn) void save(next);
    },
    [apply, signedIn]
  );

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** The chosen language and the means to change it. */
export function useLanguage(): LanguageState {
  return useContext(LanguageContext);
}

/**
 * `t` for this screen's words, and `locale` for its dates and numbers
 * (toLocaleDateString(locale, …)).
 */
export function useT(): { t: Translate; lang: Lang; locale: string } {
  const { lang } = useContext(LanguageContext);
  return useMemo(() => ({ t: (key, vars) => translate(lang, key, vars), lang, locale: INTL_LOCALE[lang] }), [lang]);
}
