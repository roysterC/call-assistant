"use client";

/**
 * How many callbacks are waiting, for the red counter beside "Callbacks" in
 * the menu (and the dot on the phone's menu button).
 *
 * One count shared by everything that shows it, fetched once a minute, again
 * when the window comes back into focus, and at once when a callback is
 * ticked off (callbacksChanged). A message the receptionist takes therefore
 * shows within the minute, without anyone opening the page.
 */

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";

const CHANGED = "kikai:callbacks-changed";
const EVERY_MS = 60_000;

let count = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function set(next: number) {
  if (next === count) return;
  count = next;
  for (const l of listeners) l();
}

async function refresh() {
  try {
    const res = await apiFetch("/api/callbacks?count=1");
    // Signed out, or a login that cannot see callbacks: nothing to show.
    if (!res.ok) return set(0);
    const data = await res.json();
    set(Math.max(0, Number(data.pending) || 0));
  } catch {
    // Offline for a moment: keep the last count rather than flash to zero.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(refresh, EVERY_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(CHANGED, refresh);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CHANGED, refresh);
    }
  };
}

const noSubscribe = () => () => {};

/** Callbacks waiting; 0 when `enabled` is false (no voice). */
export function usePendingCallbacks(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribe : noSubscribe,
    () => (enabled ? count : 0),
    () => 0
  );
}

/** Count again now: after a callback is completed, or the organisation changes. */
export function callbacksChanged() {
  window.dispatchEvent(new Event(CHANGED));
}
