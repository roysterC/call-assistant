"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Bot, LogIn } from "lucide-react";
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
    // chrome hidden, so the card sits slightly below centre until you scroll.
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 shrink-0 bg-blue-600 rounded-xl flex items-center justify-center">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg">Kikai Call Assistant</CardTitle>
              <p className="text-xs text-muted-foreground">
                Sign in to continue
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
                className="mt-1"
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
                className="mt-1"
              />
            </div>

            {/*
              role="alert" so the failure is announced. It was a plain <p>:
              a screen-reader user pressed Sign in, heard nothing, and had no
              way to know the attempt had been rejected.
            */}
            {message && (
              <p role="alert" className="text-xs text-red-400">
                {message}
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              <LogIn className="w-4 h-4 mr-2" />
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-6 text-center">
            Don&apos;t have an account? Your administrator will invite you.
          </p>
        </CardContent>
      </Card>
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
