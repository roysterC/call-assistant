"use client";

/**
 * The frame for the pages someone sees before or without signing in:
 * joining, forgot password, reset password, confirm email. The brand, the
 * language flags, a heading, and one thing to do.
 */

import { BrandMark } from "@/components/dashboard/sidebar";
import { LanguageFlags } from "@/components/i18n/language-flags";

export function AuthCard({
  title,
  intro,
  children,
}: {
  title?: string;
  intro?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-background p-6 pt-16">
      <LanguageFlags className="absolute top-4 right-4" />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark size="lg" />
          <span className="font-heading text-xl font-semibold">Kikai</span>
        </div>
        {title && <h1 className="font-heading text-2xl font-semibold">{title}</h1>}
        {intro && <div className="mt-1.5 text-sm text-muted-foreground">{intro}</div>}
        {children && <div className={title || intro ? "mt-6" : undefined}>{children}</div>}
      </div>
    </main>
  );
}
