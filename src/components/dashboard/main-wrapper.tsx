"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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

  const isFullWidth = pathname?.startsWith("/conversations");

  return (
    <div className="h-full flex w-full">
      <Suspense fallback={<SidebarFallback />}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 overflow-auto">
        {isFullWidth ? (
          <div className="h-full">{children}</div>
        ) : (
          <div className="max-w-7xl mx-auto p-8">{children}</div>
        )}
      </main>
    </div>
  );
}

function SidebarFallback() {
  return (
    <aside className="w-64 bg-card border-r border-border" aria-hidden />
  );
}
