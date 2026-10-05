"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { clientDevBypassEnabled } from "@/lib/dev-bypass";

// Mock session used only when NEXT_PUBLIC_DEV_BYPASS_AUTH=1 (local dev), and
// never in a production build. Server-side, requireTenant() returns a
// matching mock context.
const mockSession: Session = {
  user: {
    id: "dev-user",
    email: "roy.cheung@doaisystems.co.uk",
    name: "Roy Cheung",
    organizationId: null,
    organizationName: "Kikai",
    role: "superAdmin",
    sessionVersion: 0,
  },
  expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const bypass = clientDevBypassEnabled();

  if (bypass) {
    // Pin the mock session. Disable refetch so NextAuth doesn't hit
    // /api/auth/session and clobber our mock with null.
    return (
      <NextAuthSessionProvider
        session={mockSession}
        refetchInterval={0}
        refetchOnWindowFocus={false}
        refetchWhenOffline={false}
      >
        {children}
      </NextAuthSessionProvider>
    );
  }

  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
