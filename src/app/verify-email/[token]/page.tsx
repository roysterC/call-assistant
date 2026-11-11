"use client";

/**
 * Where a confirmation link lands. Confirmed by pressing the button, not by
 * opening the page: mail scanners open links, and must not confirm an
 * address for someone (src/app/api/verify-email).
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CircleCheck, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthCard } from "@/components/auth/auth-card";
import { useT } from "@/components/providers/language-provider";

export default function VerifyEmailPage() {
  const { t } = useT();
  const { token } = useParams<{ token: string }>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setDone(d.email);
      else
        setProblem(
          d.code === "gone" ? t("auth.err.gone.verify") : res.status === 429 ? t("common.tooMany") : t("auth.err.invalid")
        );
    } catch {
      setProblem(t("common.offline"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title={t("auth.verifiedTitle")} intro={t("auth.verifiedIntro", { email: done })}>
        <div className="flex items-center gap-3">
          <CircleCheck className="h-5 w-5 text-primary" aria-hidden />
          <Link href="/start" className={buttonVariants({ variant: "outline" })}>
            {t("auth.goToKikai")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.verifyTitle")} intro={t("auth.verifyIntro")}>
      <div className="space-y-3">
        <Button onClick={confirm} disabled={busy} className="w-full">
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {t("auth.verifyButton")}
        </Button>
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>
    </AuthCard>
  );
}
