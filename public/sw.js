/*
 * Booking alerts on a phone or computer (src/lib/push.ts). This is all the
 * service worker does: it shows the push it is sent and opens the booking
 * when the alert is tapped. It caches nothing and handles no requests, so
 * the diary is always the live one (see src/app/manifest.ts).
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // An open CRM shows the pop-up at once rather than at its next check.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) w.postMessage({ type: "booking-notice" });
      // Always shown: phones stop delivering to a site whose pushes show nothing.
      await self.registration.showNotification(data.title || "New booking", {
        body: data.body || "",
        tag: data.tag,
        data: { url: data.url || "/calendar" },
        icon: "/icons/icon-192.png?v=3",
        badge: "/icons/icon-192.png?v=3",
        // On a computer it stays until it is dealt with, like the pop-up.
        requireInteraction: true,
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/calendar", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === url.origin);
      if (open) {
        await open.focus();
        // The page opens the booking itself, without reloading.
        open.postMessage({ type: "open-booking", url: url.pathname + url.search });
        return;
      }
      await self.clients.openWindow(url.href);
    })()
  );
});
