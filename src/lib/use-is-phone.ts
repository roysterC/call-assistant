"use client";

/**
 * Whether the screen is phone-sized: below Tailwind's md, where the app's
 * own `max-md:` styles switch too, so the layout decided here and the one CSS
 * draws always agree.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // Server render: assume a larger screen; the client corrects on hydration.
    () => false
  );
}
