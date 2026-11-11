"use client";

/**
 * Where an invite link lands (src/lib/invitations.ts): the salon and the
 * address it is for, and a name and password to choose. Making the login
 * signs them straight in and takes them on to set the salon up.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/dashboard/sidebar";

type Invite = { email: string; salon: string };

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/invite?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok) setInvite(d);
        else setProblem(d.error || "This link is not valid.");
      })
      .catch(() => live && setProblem("Couldn't open this link. Check your connection and try again."));
    return () => {
      live = false;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    if (password !== again) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Couldn't make your login. Try again.");
        setBusy(false);
        return;
      }
      const signedIn = await signIn("credentials", { email: invite.email, password, redirect: false });
      if (signedIn?.error) {
        // The login is made; only signing in failed. The login page will do.
        router.push("/login");
        return;
      }
      router.push("/start");
      router.refresh();
    } catch {
      setError("Couldn't make your login. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <BrandMark size="lg" />
          <span className="font-heading text-xl font-semibold">Kikai</span>
        </div>

        {problem ? (
          <div className="space-y-4">
            <h1 className="font-heading text-2xl font-semibold">This link doesn&apos;t work</h1>
            <p className="text-sm text-muted-foreground">{problem}</p>
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              Go to sign in
            </Link>
          </div>
        ) : !invite ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <h1 className="font-heading text-2xl font-semibold">Welcome to Kikai</h1>
              <p className="text-sm text-muted-foreground">
                Make your login for <span className="font-medium text-foreground">{invite.salon}</span>. Next,
                we&apos;ll set up your salon together: it takes a few minutes.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <Input id="email" value={invite.email} readOnly disabled autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">Your name</label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">Choose a password</label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
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

            <Button type="submit" className="w-full" disabled={busy || !name.trim() || password.length < 8 || !again}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {busy ? "Making your login…" : "Make my login"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
