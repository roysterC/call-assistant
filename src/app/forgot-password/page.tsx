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

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPassword />
    </Suspense>
  );
}

function ForgotPassword() {
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
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Couldn't send the link. Try again.");
      else setSentTo(email.trim());
    } catch {
      setError("Couldn't reach Kikai. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthCard
        title="Check your email"
        intro={
          <>
            If <span className="font-medium text-foreground">{sentTo}</span>{" "}has a Kikai login, we&apos;ve sent it a
            link to choose a new password. It works for an hour. Not there? Look in spam, or check the address.
          </>
        }
      >
        <div className="flex items-center gap-3">
          <MailCheck className="h-5 w-5 text-primary" aria-hidden />
          <Link href="/login" className="text-sm font-medium underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" intro="Enter the email you sign in with and we'll send you a link to choose a new one.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
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
          Send me a link
        </Button>
        <p className="text-center text-sm">
          <Link href="/login" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
