"use client";

/**
 * The CRM's front door: sends a signed-in user to their organisation's start
 * page (Settings → Start page; the diary for a salon, the dashboard for
 * everyone else). Signing in lands here, so this is the first screen.
 *
 * A stylist login is sent to the diary by MeProvider, whatever the salon's
 * start page, since the diary is what a stylist login is for.
 */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { DASHBOARD } from "@/lib/navigation";

export default function Home() {
  // useSearchParams needs a Suspense boundary for the page to prerender.
  return (
    <Suspense fallback={null}>
      <GoToStartPage />
    </Suspense>
  );
}

function GoToStartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const asOrg = searchParams.get("asOrg");
  // Opened by /assistant (Siri, Google Assistant): keep the assistant listening.
  const assistant = searchParams.get("assistant") === "listen";

  useEffect(() => {
    let live = true;
    // A super-admin viewing another organisation stays viewing it.
    const params = new URLSearchParams();
    if (asOrg) params.set("asOrg", asOrg);
    if (assistant) params.set("assistant", "listen");
    const suffix = params.size ? `?${params}` : "";
    apiFetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live) router.replace(`${d?.startPage ?? DASHBOARD}${suffix}`);
      })
      .catch(() => {
        if (live) router.replace(`${DASHBOARD}${suffix}`);
      });
    return () => {
      live = false;
    };
  }, [asOrg, assistant, router]);

  return null;
}
