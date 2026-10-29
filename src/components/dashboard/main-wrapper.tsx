"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandMark, Navigation } from "@/components/dashboard/sidebar";
import { Assistant } from "@/components/voice-booking/assistant";
import { BookingAlerts } from "@/components/notifications/booking-alerts";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useCollapsedNav();
  // Embed, login, the in-person funnel and the public legal pages: no
  // sidebar, no padding, no chrome. The legal pages must render standalone so
  // Meta's app-review crawler (and end users) see them without logged-in UI.
  const chromeless = [
    "/embed",
    "/login",
    "/meet",
    "/privacy-policy",
    "/terms-of-service",
    "/data-deletion",
  ].some((p) => pathname?.startsWith(p));
  if (chromeless) {
    return <>{children}</>;
  }

  // Screens that manage their own height and scroll internally. They get the
  // full pane and no page padding; anything that scrolls does so inside them.
  const isFullWidth =
    pathname?.startsWith("/conversations") || pathname?.startsWith("/calendar");

  return (
    <div className="h-full flex flex-col w-full">
      {/* A phone's header: who this is. The menu is the tab bar along the
          bottom (Navigation). */}
      <header className="md:hidden shrink-0 h-14 flex items-center gap-3 px-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <BrandMark size="sm" alt="" />
        <span className="font-heading font-semibold text-[0.95rem] tracking-tight truncate text-cornsilk-500">Kikai</span>
      </header>

      <div className="flex flex-1 min-h-0 w-full">
        <Suspense fallback={<SidebarFallback collapsed={collapsed} />}>
          <Navigation collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} />
        </Suspense>

        {/* The personal assistant: on every signed-in page. */}
        <Assistant />
        {/* The receptionist's new bookings, until each is closed or opened. */}
        <BookingAlerts />

        {/* On a phone, clear of the tab bar along the bottom. */}
        <main className="flex-1 overflow-auto min-w-0 max-md:pb-[calc(4rem+env(safe-area-inset-bottom))]">
          {isFullWidth ? (
            <div className="h-full">{children}</div>
          ) : (
            <div className="max-w-7xl mx-auto p-4 md:p-8">{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarFallback({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={`hidden md:block m-3 mr-0 rounded-[28px] ${collapsed ? "w-[76px]" : "w-64"} bg-sidebar shrink-0`}
      aria-hidden
    />
  );
}

const COLLAPSED_KEY = "sidebar-collapsed";

/**
 * Whether the menu is folded to its icon rail, remembered in this browser.
 *
 * Read after mount rather than during render: the server has no storage, and
 * reading it in render would give the server and the browser different
 * markup. Storage can be missing or refuse (private windows), so both sides
 * are guarded and the menu simply starts open.
 */
function useCollapsedNav(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
      if (window.localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // No storage: start open.
    }
  }, []);
  const set = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, but still folded for this visit.
    }
  };
  return [collapsed, set];
}
