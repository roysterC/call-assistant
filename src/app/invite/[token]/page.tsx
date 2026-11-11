"use client";

/**
 * Where an invite link lands (src/lib/invitations.ts): the salon and the
 * address it is for, and a name and password to choose. Opens in the
 * language Kikai invited them in, with the flags to change it. Making the
 * login signs them straight in and takes the owner on to set the salon up.
 *
 * An expired link offers a new one, sent to the address it was for.
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Loader2, MailCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { useLanguage, useT } from "@/components/providers/language-provider";
import { isLang, type MessageKey } from "@/lib/i18n";

type Invite = { email: string; salon: string; role: string; language: string };

const ERRORS = ["invalid", "used", "replaced", "expired", "inactive", "taken", "name"] as const;
type ErrorCode = (typeof ERRORS)[number];
const errorKey = (code: unknown): MessageKey =>
  ERRORS.includes(code as ErrorCode) ? (`inv.err.${code}` as MessageKey) : "inv.err.invalid";

export default function InvitePage() {
  const { t } = useT();
  const { setLang } = useLanguage();
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [problem, setProblem] = useState<{ code: string } | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewed, setRenewed] = useState(false);
  const { lang } = useLanguage();
  // The invite's language is applied once, on arrival; after that the flags decide.
  const applied = useRef(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/invite?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok) {
          setInvite(d);
          if (!applied.current && isLang(d.language)) setLang(d.language);
          applied.current = true;
        } else setProblem({ code: r.status === 429 ? "tooMany" : d.code ?? "invalid" });
      })
      .catch(() => live && setProblem({ code: "offline" }));
    return () => {
      live = false;
    };
  }, [token, setLang]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password, language: lang }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (["used", "replaced", "expired", "inactive", "invalid"].includes(d.code)) setProblem({ code: d.code });
        else setError(d.code === "weak" ? t("pw.short") : res.status === 429 ? t("common.tooMany") : d.code ? t(errorKey(d.code)) : t("inv.failed"));
        setBusy(false);
        return;
      }
      const signedIn = await signIn("credentials", { email: invite.email, password, redirect: false });
      // The login is made either way; only signing in might fail.
      router.push(signedIn?.error ? "/login" : "/start");
      router.refresh();
    } catch {
      setError(t("common.offline"));
      setBusy(false);
    }
  }

  async function renew() {
    setBusy(true);
    try {
      await fetch("/api/invite/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setRenewed(true);
    } catch {
      setError(t("common.offline"));
    } finally {
      setBusy(false);
    }
  }

  if (problem) {
    const message =
      problem.code === "offline" ? t("common.offline") : problem.code === "tooMany" ? t("common.tooMany") : t(errorKey(problem.code));
    if (renewed) {
      return (
        <AuthCard title={t("auth.checkTitle")} intro={t("inv.renewed")}>
          <MailCheck className="h-5 w-5 text-primary" aria-hidden />
        </AuthCard>
      );
    }
    return (
      <AuthCard title={t("inv.broken")} intro={message}>
        <div className="flex flex-wrap gap-2">
          {problem.code === "expired" && (
            <Button onClick={renew} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("inv.renew")}
            </Button>
          )}
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            {t("inv.toSignIn")}
          </Link>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </AuthCard>
    );
  }

  if (!invite) {
    return (
      <AuthCard>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("inv.welcome")}
      intro={invite.role === "admin" ? t("inv.intro", { salon: invite.salon }) : t("inv.introStaff", { salon: invite.salon })}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">{t("inv.email")}</label>
          <Input id="email" value={invite.email} readOnly disabled autoComplete="username" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium">{t("inv.name")}</label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">{t("inv.password")}</label>
          <PasswordInput id="password" value={password} onChange={setPassword} />
          <p className="text-xs text-muted-foreground">{t("pw.hint")}</p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || !name.trim() || password.length < 8}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {busy ? t("inv.submitting") : t("inv.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
