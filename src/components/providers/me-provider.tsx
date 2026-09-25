"use client";

/**
 * Who is signed in, for the screens to shape themselves around, and the
 * redirects that keep a stylist login on the pages made for it.
 *
 * This is presentation only. Every API route decides for itself what a login
 * may see, so if this got something wrong a stylist would see an error, not
 * someone else's data.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";

export interface Me {
  role: string;
  name: string | null;
  email: string | null;
  stylist: { name: string; diaryScope: "own" | "salon"; canSeeTakings: boolean } | null;
  mustChangePassword: boolean;
}

const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}

const PUBLIC = ["/login", "/embed", "/privacy-policy", "/terms-of-service", "/data-deletion"];
const ACCOUNT = "/settings/account";

/** The pages a stylist login is for. Everything else sends them to the diary. */
export function stylistMayVisit(me: Me, path: string): boolean {
  if (path === ACCOUNT) return true;
  if (path.startsWith("/calendar") || path.startsWith("/appointments")) return true;
  if (path.startsWith("/sales")) return Boolean(me.stylist?.canSeeTakings);
  return false;
}

export function MeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname() ?? "/";
  const router = useRouter();
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
    // Re-read on navigation, so a password just changed or a permission just
    // withdrawn is reflected without signing out and in.
  }, [status, isPublic, pathname]);

  useEffect(() => {
    if (!me?.stylist || isPublic) return;
    if (me.mustChangePassword) {
      if (pathname !== ACCOUNT) router.replace(`${ACCOUNT}?first=1`);
      return;
    }
    if (!stylistMayVisit(me, pathname)) router.replace("/calendar");
  }, [me, pathname, isPublic, router]);

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
