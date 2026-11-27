"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { LanguageFlags } from "@/components/i18n/language-flags";
import { BrandMark, Navigation, navWidth } from "@/components/dashboard/sidebar";
import { Assistant } from "@/components/voice-booking/assistant";
import { BookingAlerts } from "@/components/notifications/booking-alerts";
import { QuoteAlerts } from "@/components/notifications/quote-alerts";
import { NotificationsBell, NotificationsRuntime } from "@/components/notifications/notifications-panel";
import { useMediaQuery } from "@/lib/use-is-phone";
import { PlanBanner } from "@/components/billing/plan-banner";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed, openedNarrow] = useCollapsedNav();
  // Embed, login, the in-person funnel and the public legal pages: no
  // sidebar, no padding, no chrome. The legal pages must render standalone so
  // Meta's app-review crawler (and end users) see them without logged-in UI.
  const chromeless = [
    "/embed",
    // A salon's own website and online booking, for its clients.
    "/s/",
    "/login",
    "/meet",
    // Rebooking text links, opened by clients (src/app/r).
    "/r/",
    "/privacy-policy",
    "/terms-of-service",
    "/data-deletion",
    // An owner's invite link, and setting the salon up (src/app/onboarding).
    "/invite/",
    "/onboarding",
    "/forgot-password",
    "/reset-password/",
    "/verify-email/",
  ].some((p) => pathname?.startsWith(p));
  if (chromeless) {
    return <>{children}</>;
  }

  // Screens that manage their own height and scroll internally. They get the
  // full pane and no page padding; anything that scrolls does so inside them.
  const isFullWidth =
    pathname?.startsWith("/conversations") ||
    pathname?.startsWith("/calendar") ||
    pathname?.startsWith("/callbacks") ||
    pathname?.startsWith("/clients");

  return (
    <div className="h-full flex flex-col w-full">
      <OnboardingGate />
      {/* A phone's header: who this is. The menu is the tab bar along the
          bottom (Navigation). */}
      <header className="md:hidden shrink-0 h-14 flex items-center gap-3 px-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <BrandMark size="sm" alt="" />
        <span className="flex-1 font-heading font-semibold text-[0.95rem] tracking-tight truncate text-cornsilk-500">Kikai</span>
        <NotificationsBell variant="header" />
        <LanguageFlags tone="dark" />
      </header>

      <div className="flex flex-1 min-h-0 w-full">
        <Suspense fallback={<SidebarFallback collapsed={collapsed} openedNarrow={openedNarrow} />}>
          <Navigation collapsed={collapsed} openedNarrow={openedNarrow} onToggleCollapsed={() => setCollapsed(!collapsed)} />
        </Suspense>

        {/* The personal assistant: on every signed-in page. */}
        <Assistant />
        {/* Pop-ups, stacked in one corner so they never sit on each other:
            bottom right, above the assistant's button; on a phone, just above
            the tab bar. At the top they covered each page's title, its
            filters and its own buttons (New booking) until closed. */}
        <div className="pointer-events-none fixed inset-x-2 bottom-[calc(68px+1.25rem+max(0.75rem,env(safe-area-inset-bottom)))] z-50 flex flex-col gap-2 md:inset-x-auto md:bottom-24 md:right-6 md:w-[360px] [&>*]:pointer-events-auto">
          {/* Clients waiting for a price on their designs. */}
          <QuoteAlerts />
          {/* The receptionist's new bookings, until each is closed or opened. */}
          <BookingAlerts />
        </div>
        {/* The count in the tab's title and on the app's icon, and the chime. */}
        <NotificationsRuntime />

        {/* On a phone, clear of the tab bar along the bottom. */}
        <main className="flex flex-1 flex-col overflow-auto min-w-0 phone:pb-[calc(68px+1.5rem+max(0.75rem,env(safe-area-inset-bottom)))]">
          {/* The trial ending, a failed payment, or the plan paused (src/lib/plan.ts). */}
          <PlanBanner />
          {isFullWidth ? (
            // On a short screen their header and the tab bar left the diary
            // or a profile a strip a finger wide; there the page scrolls instead.
            <div className="min-h-0 flex-1 short:min-h-[36rem]">{children}</div>
          ) : (
            <div className="w-full max-w-7xl mx-auto p-4 md:p-8">{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * A salon not set up yet goes to onboarding, whichever page was opened: a
 * bookmark or a link must not land the owner in an empty diary. Asked once
 * per load of the app; the onboarding page's Finish clears it.
 */
function OnboardingGate() {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    apiFetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.needsOnboarding) router.replace("/onboarding");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [router]);
  return null;
}

function SidebarFallback({ collapsed, openedNarrow }: { collapsed: boolean; openedNarrow: boolean }) {
  return (
    <aside
      className={`hidden md:block m-3 mr-0 rounded-[28px] ${navWidth(collapsed, openedNarrow)} bg-sidebar shrink-0`}
      aria-hidden
    />
  );
}

const COLLAPSED_KEY = "sidebar-collapsed";

/**
 * Whether the menu is folded to its icon rail.
 *
 * On a laptop or larger the choice is remembered in this browser. Read after
 * mount rather than during render: the server has no storage, and reading it
 * in render would give the server and the browser different markup. Storage
 * can be missing or refuse (private windows), so both sides are guarded and
 * the menu simply starts open.
 *
 * Below 1280px (a tablet, a small laptop) the open menu took a quarter of the
 * screen and left the pages with a list and a detail beside it a sliver, so
 * there it starts folded, whatever was remembered; opening it there lasts
 * until the page is left and is not remembered.
 */
function useCollapsedNav(): [collapsed: boolean, set: (next: boolean) => void, openedNarrow: boolean] {
  const [collapsed, setCollapsed] = useState(false);
  const narrow = useMediaQuery("(max-width: 1279px)");
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
      if (window.localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // No storage: start open.
    }
  }, []);
  if (narrow) {
    return [openedOn !== pathname, (next) => setOpenedOn(next ? null : pathname), openedOn === pathname];
  }
  const set = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, but still folded for this visit.
    }
  };
  return [collapsed, set, false];
}
