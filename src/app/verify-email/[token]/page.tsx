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

export default function VerifyEmailPage() {
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
      else setProblem(d.error || "This link is not valid.");
    } catch {
      setProblem("Couldn't reach Kikai. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard
        title="Email confirmed"
        intro={
          <>
            <span className="font-medium text-foreground">{done}</span>{" "}is confirmed. If you ever forget your password,
            you can reset it from the sign-in page.
          </>
        }
      >
        <div className="flex items-center gap-3">
          <CircleCheck className="h-5 w-5 text-primary" aria-hidden />
          <Link href="/start" className={buttonVariants({ variant: "outline" })}>
            Go to Kikai
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Confirm your email" intro="Press the button to confirm this address is yours.">
      <div className="space-y-3">
        <Button onClick={confirm} disabled={busy} className="w-full">
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Confirm my email
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
