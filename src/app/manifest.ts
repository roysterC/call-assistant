import type { MetadataRoute } from "next";

/**
 * What a phone needs to put the app on its home screen and open it like an
 * app: its own icon, its own window with no browser bars, straight into the
 * diary.
 *
 * Named for what it opens rather than for any one salon, because every salon
 * on the system is served from the same address and so shares this file.
 *
 * Deliberately no service worker: nothing is cached for offline use. A diary
 * shown from a cache would show yesterday's bookings as today's, and a
 * booking made offline would have nowhere to go.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/calendar",
    name: "Salon Diary",
    short_name: "Diary",
    description: "Your salon's diary, bookings and takings.",
    start_url: "/calendar",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    // The query is a version: phones keep the icon they first fetched, so a
    // redrawn icon needs a new address before they will look again.
    icons: [
      { src: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
