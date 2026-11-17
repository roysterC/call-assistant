"use client";

/**
 * What is waiting on this person (src/lib/notifications.ts), kept current
 * for the whole CRM: the bell and its panel, the counts beside the menu's
 * pages, the count in the browser tab and on the app's icon, and the sound.
 *
 * One store shared by everything that shows it. Fetched every half minute,
 * when the window comes back into focus, at once when a push arrives on this
 * device (the service worker says so), and when something is dealt with
 * here: a booking opened or a pop-up closed (noticesChanged), a callback
 * ticked off (callbacksChanged), or notificationsChanged.
 *
 * The sound: a short chime when something arrives that was not there at
 * the last look. Not for what is already waiting when the CRM opens, and
 * never twice for the same thing. Each device can turn it off.
 */

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { onServiceWorkerMessage } from "@/lib/push-client";
import type { Notifications } from "@/lib/notifications";

const CHANGED = "kikai:notifications-changed";
/** The other stores' own "look again" events: the same changes matter here. */
const ALSO_CHANGED = ["kikai:booking-notices-changed", "kikai:callbacks-changed"];
const EVERY_MS = 30_000;
const SOUND_KEY = "kikai-notification-sound";

export type NotificationState = Notifications & { loaded: boolean };

const EMPTY: NotificationState = {
  counts: { booking: 0, callback: 0, quote: 0 },
  total: 0,
  items: [],
  timeZone: "Europe/London",
  loaded: false,
};

let state: NotificationState = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let stopSw: (() => void) | null = null;
const listeners = new Set<() => void>();
/** Everything already heard (or waiting when the CRM opened): no chime for these. */
const heard = new Set<string>();

function set(next: NotificationState) {
  state = next;
  for (const l of listeners) l();
}

async function refresh() {
  try {
    const res = await apiFetch("/api/notifications");
    if (!res.ok) return;
    const data = (await res.json()) as Notifications;
    const fresh = data.items.filter((i) => !heard.has(i.key));
    for (const i of data.items) heard.add(i.key);
    // The first look only learns what is already there.
    if (state.loaded && fresh.length > 0 && soundOn()) chime();
    set({ ...data, loaded: true });
  } catch {
    // Offline for a moment: keep what is showing.
  }
}

const onShow = () => {
  if (document.visibilityState === "visible") void refresh();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(refresh, EVERY_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onShow);
    for (const e of [CHANGED, ...ALSO_CHANGED]) window.addEventListener(e, refresh);
    // Any push: a booking, a quote or a callback.
    stopSw = onServiceWorkerMessage((msg) => {
      if (msg.type === "booking-notice") void refresh();
    });
    unlockAudioOnGesture();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onShow);
      for (const e of [CHANGED, ...ALSO_CHANGED]) window.removeEventListener(e, refresh);
      stopSw?.();
      stopSw = null;
    }
  };
}

const noSubscribe = () => () => {};

/** What is waiting; nothing while `enabled` is false (signed out, a page without the CRM's menu). */
export function useNotifications(enabled = true): NotificationState {
  return useSyncExternalStore(
    enabled ? subscribe : noSubscribe,
    () => (enabled ? state : EMPTY),
    () => EMPTY
  );
}

/** Something was dealt with here: look again now. */
export function notificationsChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

// ── The sound ────────────────────────────────────────────────────────────────

const soundListeners = new Set<() => void>();

function soundOn(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Whether this device plays the chime; on unless turned off here. */
export function useNotificationSound(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (l) => {
      soundListeners.add(l);
      return () => soundListeners.delete(l);
    },
    soundOn,
    () => true
  );
  const setOn = (next: boolean) => {
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Not remembered; nothing else to do.
    }
    for (const l of soundListeners) l();
    if (next) chime();
  };
  return [on, setOn];
}

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  audio ??= new Ctx();
  return audio;
}

/**
 * Browsers only let a page make a sound once someone has clicked or tapped
 * on it. The first touch anywhere readies it, so the chime can play later.
 */
function unlockAudioOnGesture() {
  const unlock = () => {
    void context()?.resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** Two soft rising notes: noticeable across a salon, not alarming. */
export function chime() {
  const ctx = context();
  if (!ctx || ctx.state === "suspended") return;
  const now = ctx.currentTime;
  for (const [i, freq] of [880, 1318.5].entries()) {
    const start = now + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.5);
  }
}
