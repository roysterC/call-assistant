"use client";

/**
 * Where signing in lands: sends a signed-in user to their organisation's start
 * page (Settings → Start page; the diary for a salon, the dashboard for
 * everyone else). The site's root is the login page, not this.
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
