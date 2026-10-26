"use client";

/**
 * Turning booking alerts on and off for this device (the browser side of
 * src/lib/push.ts). An iPhone or iPad only offers push to the app added to
 * its home screen, so there the answer may be "add it first".
 */

import { signOut } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";

export type PushState =
  /** This browser cannot do push at all. */
  | "unsupported"
  /** An iPhone or iPad in Safari: push needs the home-screen app. */
  | "needs-home-screen"
  /** Alerts were blocked for this site in the browser's settings. */
  | "blocked"
  | "off"
  | "on";

const SW_URL = "/sw.js";
const SUBSCRIBE_TIMEOUT_MS = 20_000;

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isHomeScreenApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isHomeScreenApp()) return "needs-home-screen";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return (await existingSubscription()) ? "on" : "off";
}

/** The server's key, as the browser wants it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Ask, subscribe and tell the server. Must run from a tap: browsers only ask then. */
export async function turnPushOn(): Promise<{ ok: true } | { ok: false; message: string }> {
  const state = await pushState();
  if (state === "needs-home-screen") {
    return { ok: false, message: "On an iPhone or iPad, add the diary to your home screen first, then turn alerts on from there." };
  }
  if (state === "unsupported") return { ok: false, message: "This browser cannot show alerts." };
  const keyRes = await apiFetch("/api/push");
  const { publicKey } = (await keyRes.json().catch(() => ({}))) as { publicKey?: string | null };
  if (!publicKey) return { ok: false, message: "Alerts are not set up on the server yet." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, message: "Alerts were not allowed. They can be allowed in the browser's settings for this site." };
  }
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different key (the server's was replaced) is no use.
  const current = sub?.options.applicationServerKey;
  if (sub && current && !sameBytes(new Uint8Array(current), keyBytes(publicKey))) {
    await sub.unsubscribe();
    sub = null;
  }
  // The browser asks its push service (Google's, Apple's, Mozilla's) for an
  // address; on a network that blocks it, the answer never comes.
  sub ??= await Promise.race([
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SUBSCRIBE_TIMEOUT_MS)),
  ]);
  if (!sub) {
    return { ok: false, message: "This browser's alert service did not answer. Check the connection and try again." };
  }
  const res = await apiFetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  return res.ok ? { ok: true } : { ok: false, message: "Could not save this device. Try again." };
}

/** Stop alerts on this device, and tell the server to forget it. */
export async function turnPushOff(): Promise<void> {
  if (!supported()) return;
  const sub = await existingSubscription();
  if (!sub) return;
  await apiFetch("/api/push", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * Sign out, and stop this device's alerts first: a shared desk computer or a
 * phone handed on should not keep showing the last person's bookings.
 */
export async function signOutOfDevice(): Promise<void> {
  await turnPushOff().catch(() => {});
  await signOut({ callbackUrl: "/login" });
}

/**
 * The service worker's messages to an open page: a booking arrived, or an
 * alert was tapped. Registered on every signed-in page, so an alert tapped
 * on a computer finds the CRM already open.
 */
export function onServiceWorkerMessage(handler: (msg: { type?: string; url?: string }) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const listener = (e: MessageEvent) => handler((e.data ?? {}) as { type?: string; url?: string });
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
