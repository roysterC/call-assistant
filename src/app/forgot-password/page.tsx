"use client";

/**
 * "Forgot password?": an email, and a link to it if it has a login
 * (src/lib/auth-tokens.ts). The answer is the same whether it has or not.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/components/auth/auth-card";
import { useT } from "@/components/providers/language-provider";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPassword />
    </Suspense>
  );
}

function ForgotPassword() {
  const { t } = useT();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setSentTo(email.trim());
      else setError(res.status === 429 ? t("common.tooMany") : t("auth.enterEmail"));
    } catch {
      setError(t("common.offline"));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthCard title={t("auth.checkTitle")} intro={t("auth.checkIntro", { email: sentTo })}>
        <div className="flex items-center gap-3">
          <MailCheck className="h-5 w-5 text-primary" aria-hidden />
          <Link href="/login" className="text-sm font-medium underline-offset-2 hover:underline">
            {t("auth.back")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.forgotTitle")} intro={t("auth.forgotIntro")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">{t("inv.email")}</label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {t("auth.send")}
        </Button>
        <p className="text-center text-sm">
          <Link href="/login" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {t("auth.back")}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
