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
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { useT } from "@/components/providers/language-provider";

export default function ResetPasswordPage() {
  const { t } = useT();
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "gone" | "offline">("checking");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/password-reset?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (live) setState(r.ok ? "ready" : d.code === "gone" ? "gone" : "invalid");
      })
      .catch(() => live && setState("offline"));
    return () => {
      live = false;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
        if (d.code === "gone" || d.code === "invalid") setState(d.code);
        else setError(d.code === "weak" ? t("pw.short") : res.status === 429 ? t("common.tooMany") : t("auth.saveFailed"));
        setBusy(false);
        return;
      }
      const signedIn = await signIn("credentials", { email: d.email, password, redirect: false });
      router.push(signedIn?.error ? "/login" : "/start");
      router.refresh();
    } catch {
      setError(t("common.offline"));
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <AuthCard title={t("auth.newTitle")}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
      </AuthCard>
    );
  }
  if (state !== "ready") {
    return (
      <AuthCard
        title={t("inv.broken")}
        intro={state === "gone" ? t("auth.err.gone.reset") : state === "offline" ? t("common.offline") : t("auth.err.invalid")}
      >
        <Link href="/forgot-password" className={buttonVariants({ variant: "outline" })}>
          {t("auth.sendNew")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.newTitle")} intro={t("auth.newIntro")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">{t("auth.newPassword")}</label>
          <PasswordInput id="password" value={password} onChange={setPassword} autoFocus />
          <p className="text-xs text-muted-foreground">{t("pw.hint")}</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || password.length < 8}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {t("auth.save")}
        </Button>
      </form>
    </AuthCard>
  );
}
