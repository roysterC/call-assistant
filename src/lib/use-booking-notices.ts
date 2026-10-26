"use client";

/**
 * The receptionist's new bookings this person has not closed yet, for the
 * pop-ups in the corner (src/components/notifications/booking-alerts.tsx).
 *
 * Fetched every 30 seconds, when the window comes back into focus, at once
 * when a push arrives on this device (the service worker says so), and when
 * a notice is closed or a booking opened here (noticesChanged).
 */

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { onServiceWorkerMessage } from "@/lib/push-client";

export interface BookingNotice {
  id: string;
  createdAt: string;
  appointmentId: string;
  bookingNumber: number | null;
  clientName: string;
  serviceText: string;
  stylistName: string;
  startsAt: string;
  status: string;
}

export interface NoticeState {
  notices: BookingNotice[];
  /** All open, of which `notices` are the newest few. */
  total: number;
  timeZone: string;
}

const CHANGED = "kikai:booking-notices-changed";
const EVERY_MS = 30_000;
const EMPTY: NoticeState = { notices: [], total: 0, timeZone: "Europe/London" };

let state: NoticeState = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let stopSw: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: NoticeState) {
  state = next;
  for (const l of listeners) l();
}

async function refresh() {
  try {
    const res = await apiFetch("/api/booking-notices");
    if (!res.ok) return set(EMPTY);
    const data = await res.json();
    set({ notices: data.notices ?? [], total: Number(data.total) || 0, timeZone: data.timeZone ?? EMPTY.timeZone });
  } catch {
    // Offline for a moment: keep what is showing.
  }
}

/** Something here closed a notice or opened a booking: look again. */
export function noticesChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** Take a notice off the screen now, before the server has answered. */
export function hideNotice(id: string | "all") {
  if (id === "all") return set({ ...state, notices: [], total: 0 });
  set({ ...state, notices: state.notices.filter((n) => n.id !== id), total: Math.max(0, state.total - 1) });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(refresh, EVERY_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(CHANGED, refresh);
    stopSw = onServiceWorkerMessage((msg) => {
      if (msg.type === "booking-notice") void refresh();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CHANGED, refresh);
      stopSw?.();
      stopSw = null;
    }
  };
}

const noSubscribe = () => () => {};

/** The open notices; nothing while `enabled` is false (signed out, the widget's page). */
export function useBookingNotices(enabled: boolean): NoticeState {
  return useSyncExternalStore(
    enabled ? subscribe : noSubscribe,
    () => (enabled ? state : EMPTY),
    () => EMPTY
  );
}
