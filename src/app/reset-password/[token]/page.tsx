"use client";

/**
 * Where a reset link lands: choose a new password, and be signed in with it.
 * Every other device is signed out (src/lib/auth-tokens.ts).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/components/auth/auth-card";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | { problem: string }>("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/password-reset?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (live) setState(r.ok ? "ready" : { problem: d.error || "This link is not valid." });
      })
      .catch(() => live && setState({ problem: "Couldn't open this link. Check your connection and try again." }));
    return () => {
      live = false;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/password-reset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Couldn't change your password. Try again.");
        setBusy(false);
        return;
      }
      const signedIn = await signIn("credentials", { email: d.email, password, redirect: false });
      router.push(signedIn?.error ? "/login" : "/start");
      router.refresh();
    } catch {
      setError("Couldn't reach Kikai. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <AuthCard title="Choose a new password">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </AuthCard>
    );
  }
  if (typeof state === "object") {
    return (
      <AuthCard title="This link doesn't work" intro={state.problem}>
        <Link href="/forgot-password" className={buttonVariants({ variant: "outline" })}>
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" intro="You'll be signed out everywhere else, and signed in here with it.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">New password</label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            autoFocus
            required
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="again" className="text-sm font-medium">Type it again</label>
          <Input
            id="again"
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || password.length < 8 || !again}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save and sign in
        </Button>
      </form>
    </AuthCard>
  );
}
