"use client";

/**
 * The language switch everyone can find: a flag for each language, the one in
 * use lit, one tap to change. On every screen (the sidebar, the phone's
 * header, sign-in, joining and setting up), so someone who reads English
 * badly never has to find their way to Account first.
 *
 * Drawn, not emoji: Windows shows flag emoji as two plain letters.
 */

import { useId } from "react";
import { useLanguage, useT } from "@/components/providers/language-provider";
import { LANGUAGES, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function UkFlag({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 60 30" className={className} aria-hidden>
      <clipPath id={`${id}s`}>
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id={`${id}t`}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath={`url(#${id}s)`}>
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${id}t)`} stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

function VietnamFlag({ className }: { className?: string }) {
  // A five-pointed star centred on the flag, outer radius 6 of its 20 height.
  const points = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? 6 : 2.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(15 + r * Math.cos(a)).toFixed(2)},${(10 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 30 20" className={className} aria-hidden>
      <rect width="30" height="20" fill="#DA251D" />
      <polygon points={points} fill="#FFFF00" />
    </svg>
  );
}

const FLAG: Record<Lang, (p: { className?: string }) => React.ReactElement> = { en: UkFlag, vi: VietnamFlag };

export function LanguageFlags({
  className,
  tone = "light",
  value,
  onChange,
}: {
  className?: string;
  /** "dark" on the sidebar's dark green, "light" everywhere else. */
  tone?: "light" | "dark";
  /**
   * Choose a language for something else (an invitation) instead of the
   * screen's own: given both, the flags pick `value` and leave the screen as
   * it is.
   */
  value?: Lang;
  onChange?: (lang: Lang) => void;
}) {
  const screen = useLanguage();
  const lang = value ?? screen.lang;
  const setLang = onChange ?? screen.setLang;
  const { t } = useT();
  return (
    <div
      role="group"
      aria-label={t("lang.current", { name: LANGUAGES[lang] })}
      className={cn("inline-flex items-center gap-1", className)}
    >
      {(Object.keys(LANGUAGES) as Lang[]).map((l) => {
        const Flag = FLAG[l];
        const on = l === lang;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            onClick={() => !on && setLang(l)}
            aria-pressed={on}
            aria-label={on ? LANGUAGES[l] : t("lang.switchTo", { name: LANGUAGES[l] })}
            title={on ? LANGUAGES[l] : t("lang.switchTo", { name: LANGUAGES[l] })}
            data-testid={`lang-${l}`}
            className={cn(
              "flex h-7 w-9 items-center justify-center rounded-md transition-[opacity,box-shadow] outline-none focus-visible:ring-2",
              tone === "dark" ? "focus-visible:ring-sidebar-ring" : "focus-visible:ring-ring",
              on
                ? tone === "dark"
                  ? "bg-white/12 ring-1 ring-white/30"
                  : "bg-card ring-1 ring-border shadow-sm"
                : "opacity-55 hover:opacity-100"
            )}
          >
            <Flag className="h-[14px] w-[21px] rounded-[2px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.25)]" />
          </button>
        );
      })}
    </div>
  );
}
