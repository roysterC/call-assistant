"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { BrandMark, Sidebar } from "@/components/dashboard/sidebar";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Closed by the links themselves (Sidebar's onNavigate) and by the backdrop,
  // rather than by an effect watching the path — everything inside the drawer
  // that navigates already runs one of those.
  const [navOpen, setNavOpen] = useState(false);

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
          className="h-9 w-9 -ml-1.5 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Menu className="w-5 h-5" />
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

        <Suspense fallback={<SidebarFallback />}>
          <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        </Suspense>

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

function SidebarFallback() {
  return (
    <aside
      className="hidden md:block w-64 bg-sidebar border-r border-sidebar-border shrink-0"
      aria-hidden
    />
  );
}
