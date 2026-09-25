"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CalendarDays, LogIn, PhoneCall, Receipt } from "lucide-react";
import { BrandMark } from "@/components/dashboard/sidebar";
import { safeCallbackUrl } from "@/lib/safe-redirect";

/**
 * NextAuth puts a code in ?error=. "Something went wrong" for SessionRequired
 * tells someone whose session simply expired that the product is broken.
 */
const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  SessionRequired: "Your session has expired. Please sign in again.",
  AccessDenied: "That account doesn't have access to this CRM.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      email: email.trim(),
      password,
      redirect: false,
    });

    if (res?.error) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  const message =
    error ||
    (urlError
      ? ERROR_MESSAGES[urlError] || "Something went wrong. Please try again."
      : null);

  return (
    // dvh rather than vh: on a phone, 100vh is the viewport with the browser
    // chrome hidden, so the form sits slightly below centre until you scroll.
    <div className="min-h-dvh grid lg:grid-cols-[1fr_minmax(0,560px)] bg-background">
      {/* The brand panel: what the product is, for the first screen anyone
          sees. Hidden on a phone, where the form is the whole point. */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 p-12 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-violet-400/30 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center font-heading font-bold">
            K
          </div>
          <span className="font-heading text-lg font-semibold tracking-tight">Kikai</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="font-heading text-4xl font-semibold leading-[1.15]">
            Your diary, your clients and every call, in one place.
          </h2>
          <ul className="mt-10 space-y-5 text-indigo-50">
            {[
              { icon: CalendarDays, text: "A live diary for the whole team, on any screen" },
              { icon: PhoneCall, text: "Calls answered and booked in, day and night" },
              { icon: Receipt, text: "Takings recorded against every appointment" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3.5">
                <span className="w-9 h-9 shrink-0 rounded-lg bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span className="text-[0.95rem]">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-indigo-100/80">© Kikai</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8">
            <BrandMark size="lg" />
            <div className="min-w-0">
              <h1 className="font-heading text-xl font-semibold">
                Welcome back
              </h1>
              <p className="text-sm text-muted-foreground">
                Sign in to Kikai to continue
              </p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/*
              htmlFor/id and autoComplete. The labels were unassociated, so
              tapping one did nothing — on a phone that is a real miss — and
              without autoComplete a password manager has to guess at the
              fields, which on a two-field form it often gets wrong.
            */}
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.co.uk"
                required
                autoFocus
                disabled={loading}
                aria-invalid={message ? true : undefined}
                className="mt-1.5 h-10"
              />
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                aria-invalid={message ? true : undefined}
                className="mt-1.5 h-10"
              />
            </div>

            {/*
              role="alert" so the failure is announced. It was a plain <p>:
              a screen-reader user pressed Sign in, heard nothing, and had no
              way to know the attempt had been rejected.
            */}
            {message && (
              <p role="alert" className="text-xs text-red-600">
                {message}
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full h-10">
              <LogIn className="w-4 h-4 mr-2" />
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-8 text-center">
            Don&apos;t have an account? Your administrator will invite you.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
