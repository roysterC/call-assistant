"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { BrandMark, Sidebar } from "@/components/dashboard/sidebar";
import { Assistant } from "@/components/voice-booking/assistant";
import { usePendingCallbacks } from "@/lib/use-pending-callbacks";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Closed by the links themselves (Sidebar's onNavigate) and by the backdrop,
  // rather than by an effect watching the path — everything inside the drawer
  // that navigates already runs one of those.
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useCollapsedNav();
  // A red dot on the phone's menu button when callbacks are waiting, since
  // the counter itself is inside the closed drawer.
  const chromeless = [
    "/embed",
    "/login",
    "/privacy-policy",
    "/terms-of-service",
    "/data-deletion",
  ].some((p) => pathname?.startsWith(p));
  const pending = usePendingCallbacks(!chromeless);

  // Embed, login, and public legal pages: no sidebar, no padding, no chrome.
  // The legal pages must render standalone so Meta's app-review crawler
  // (and search engines / end users) see the content without logged-in UI.
  if (
    pathname?.startsWith("/embed") ||
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/privacy-policy") ||
    pathname?.startsWith("/terms-of-service") ||
    pathname?.startsWith("/data-deletion")
  ) {
    return <>{children}</>;
  }

  // Screens that manage their own height and scroll internally. They get the
  // full pane and no page padding; anything that scrolls does so inside them.
  const isFullWidth =
    pathname?.startsWith("/conversations") || pathname?.startsWith("/calendar");

  return (
    <div className="h-full flex flex-col w-full">
      {/*
        Mobile chrome. The nav rail was a permanent 256px column at every width,
        so on a phone it took two thirds of the screen and squeezed the content
        into what was left — the conversations list rendered about 119px wide.
        Below md the rail is now a drawer behind this button.
      */}
      <header className="md:hidden shrink-0 h-14 flex items-center gap-3 px-4 border-b border-border bg-card/95 backdrop-blur">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          className="relative h-9 w-9 -ml-1.5 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Menu className="w-5 h-5" />
          {pending > 0 && (
            <>
              <span aria-hidden className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-card" />
              <span className="sr-only">{pending} callbacks waiting</span>
            </>
          )}
        </button>
        <BrandMark size="sm" />
        <span className="font-heading font-semibold text-[0.95rem] tracking-tight truncate">Kikai</span>
      </header>

      <div className="flex flex-1 min-h-0 w-full">
        {navOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px] md:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
        )}

        <Suspense fallback={<SidebarFallback collapsed={collapsed} />}>
          <Sidebar
            open={navOpen}
            onNavigate={() => setNavOpen(false)}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(!collapsed)}
          />
        </Suspense>

        {/* The personal assistant: on every signed-in page. */}
        <Assistant />

        <main className="flex-1 overflow-auto min-w-0">
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
      className={`hidden md:block ${collapsed ? "w-16" : "w-64"} bg-sidebar border-r border-sidebar-border shrink-0`}
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
