"use client";

/**
 * Who is signed in, for the screens to shape themselves around, and the
 * redirect that keeps a member off the owner's pages.
 *
 * This is presentation only. Every API route decides for itself what a login
 * may see, so if this got something wrong the screen would show an error,
 * not someone else's data.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";
import { NAV_PAGES, START } from "@/lib/navigation";

export interface Me {
  role: string;
  name: string | null;
  email: string | null;
  /** Their chosen language ("en", "vi"), or null if they have not chosen. */
  language: string | null;
  /** Their chosen clock ("12h", "24h"), or null to follow the language. */
  clock: string | null;
  /** What the salon calls one of its team: "stylist", "nail technician" (business-types.ts). */
  staff?: string;
}

const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}

const PUBLIC = ["/login", "/embed", "/privacy-policy", "/terms-of-service", "/data-deletion"];

/** The owner's pages (websites, insights) and everything under them. */
const OWNER_PAGES = NAV_PAGES.filter((p) => p.ownerOnly).map((p) => p.href);

export function isOwnerPage(path: string): boolean {
  return OWNER_PAGES.some((href) => path === href || path.startsWith(`${href}/`));
}

/** Fire on window after changing something /api/me reports, to have it read again. */
export const ME_CHANGED = "kikai:me-changed";

export function MeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  // Raised by a screen that changed what this answers without a navigation:
  // onboarding choosing the salon's type, and so its word for the team.
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    const bump = () => setChanged((n) => n + 1);
    window.addEventListener(ME_CHANGED, bump);
    return () => window.removeEventListener(ME_CHANGED, bump);
  }, []);

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
  }, [status, isPublic, pathname, changed]);

  useEffect(() => {
    if (me?.role === "member" && !isPublic && isOwnerPage(pathname)) router.replace(START);
  }, [me, pathname, isPublic, router]);

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
