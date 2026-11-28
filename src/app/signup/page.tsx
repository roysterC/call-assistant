"use client";

/**
 * A salon signing itself up (src/lib/signup.ts): the salon's name, and the
 * owner's name, email and password. The 14-day free trial starts at once,
 * with no card; the owner is signed straight in and taken through setting
 * the salon up (onboarding).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { useLanguage, useT } from "@/components/providers/language-provider";
import type { MessageKey } from "@/lib/i18n";

const ERRORS = ["salon", "name", "email", "taken", "tooMany"] as const;

export default function SignupPage() {
  const { t } = useT();
  const { lang } = useLanguage();
  const router = useRouter();
  const [salon, setSalon] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setTaken(false);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salon, name, email, password, kk_hp: trap, language: lang }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTaken(d.code === "taken");
        setError(
          d.code === "weak"
            ? t("pw.short")
            : (ERRORS as readonly string[]).includes(d.code)
              ? t(`signup.err.${d.code}` as MessageKey)
              : t("signup.failed")
        );
        setBusy(false);
        return;
      }
      const signedIn = await signIn("credentials", { email: d.email ?? email, password, redirect: false });
      router.push(signedIn?.error ? "/login" : "/start");
      router.refresh();
    } catch {
      setError(t("common.offline"));
      setBusy(false);
    }
  }

  const ready = salon.trim() && name.trim() && email.includes("@") && password.length >= 8;

  return (
    <AuthCard title={t("signup.title")} intro={t("signup.intro")}>
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="salon" className="text-sm font-medium">{t("signup.salon")}</label>
          <Input id="salon" value={salon} onChange={(e) => setSalon(e.target.value)} autoComplete="organization" maxLength={80} autoFocus required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium">{t("signup.name")}</label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">{t("signup.email")}</label>
          <Input id="email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">{t("signup.password")}</label>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">{t("pw.hint")}</p>
        </div>
        {/* Only bots fill this in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          {/* A name no browser or password manager fills in by itself. */}
          <input id="kk_hp" name="kk_hp" aria-label="kk" tabIndex={-1} autoComplete="new-password" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}{" "}
            {taken && (
              <Link href="/login" className="font-medium underline underline-offset-2">
                {t("signup.signIn")}
              </Link>
            )}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || !ready}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {busy ? t("signup.submitting") : t("signup.submit")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("signup.terms")}{" "}
          <Link href="/terms-of-service" className="underline underline-offset-2">{t("signup.termsLink")}</Link>{" "}
          <Link href="/privacy-policy" className="underline underline-offset-2">{t("signup.privacyLink")}</Link>
        </p>
        <p className="text-sm text-muted-foreground">
          {t("signup.haveLogin")}{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-2">{t("signup.signIn")}</Link>
        </p>
      </form>
    </AuthCard>
  );
}
