"use client";

/** English or Tiếng Việt: on the login page and in Account. */

import { useLanguage, useT } from "@/components/providers/language-provider";
import { LANGUAGES, type Lang } from "@/lib/i18n";
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
