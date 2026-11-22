"use client";

/**
 * Whether the app is in its phone layout: narrower than a tablet, or shorter
 * than one (a phone on its side). The query is the `phone:` variant's in
 * globals.css, so the layout decided here and the one CSS draws always agree.
 */

import { useCallback, useSyncExternalStore } from "react";

const QUERY = "not all and (min-width: 768px) and (min-height: 500px)";

/**
 * Whether the screen is too narrow for a list with its detail beside it:
 * a phone, or a tablet held upright, below Tailwind's `lg:` (with the same
 * height rule). Pages with a list and a detail show one at a time here.
 */
const ONE_PANE = "not all and (min-width: 1024px) and (min-height: 500px)";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Server render: assume a larger screen; the client corrects on hydration.
    () => false
  );
}

export function useIsPhone(): boolean {
  return useMediaQuery(QUERY);
}

export function useIsOnePane(): boolean {
  return useMediaQuery(ONE_PANE);
}
