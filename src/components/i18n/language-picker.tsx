"use client";

/** English or Tiếng Việt: on the login page and in Account. And, in Account, the clock. */

import { useLanguage, useT } from "@/components/providers/language-provider";
import { LANGUAGES, type Clock, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguagePicker({ className }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const { t } = useT();
  return (
    <div role="radiogroup" aria-label={t("language.label")} className={cn("inline-flex rounded-lg border border-border bg-card p-0.5", className)}>
      {(Object.keys(LANGUAGES) as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          lang={l}
          onClick={() => setLang(l)}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {LANGUAGES[l]}
        </button>
      ))}
    </div>
  );
}

/** 12- or 24-hour: how times are written for this person, everywhere. */
export function ClockPicker({ className }: { className?: string }) {
  const { clock, setClock } = useLanguage();
  const { t } = useT();
  const options: Array<[Clock, string]> = [
    ["12h", t("clock.12h")],
    ["24h", t("clock.24h")],
  ];
  return (
    <div role="radiogroup" aria-label={t("clock.label")} className={cn("inline-flex rounded-lg border border-border bg-card p-0.5", className)}>
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={clock === value}
          onClick={() => setClock(value)}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            clock === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
