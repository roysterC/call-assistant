"use client";

/**
 * Who is signed in, for the screens to shape themselves around.
 *
 * This is presentation only. Every API route decides for itself what a login
 * may see, so if this got something wrong the screen would show an error,
 * not someone else's data.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";

export interface Me {
  role: string;
  name: string | null;
  email: string | null;
}

const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}

const PUBLIC = ["/login", "/embed", "/privacy-policy", "/terms-of-service", "/data-deletion"];

export function MeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname() ?? "/";
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (status !== "authenticated" || isPublic) return;
    let live = true;
    apiFetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setMe(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // Re-read on navigation, so a permission just changed is reflected
    // without signing out and in.
  }, [status, isPublic, pathname]);

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
