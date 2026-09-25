/**
 * Shared channel metadata used across the dashboard — conversation list,
 * leads table, settings cards, etc. Keep all per-channel branding (icon,
 * colour, label) in one place so visual identity stays consistent.
 *
 * Adding a new channel: add a new entry here + extend the `Channel` union
 * + update any code that switches on channel by name. The
 * `instanceof`-style checks in /api/conversations/[id]/route.ts and the
 * sidebar's feature-gate matcher are the other places to remember.
 */

import {
  MessageCircle,
  Globe,
  Camera,
  Send,
  Phone,
  type LucideIcon,
} from "lucide-react";

export type Channel =
  | "whatsapp"
  | "website"
  | "instagram"
  | "facebook"
  | "phone";

export interface ChannelMeta {
  icon: LucideIcon;
  /** Tailwind background class for the badge dot. */
  bg: string;
  /** Human-readable label for tooltips and badges. */
  label: string;
}

// Lucide 1.x removed Meta brand icons (licensing). We use evocative
// generics: Camera for Instagram (the app's original camera-shutter
// branding), Send (paper-plane) for Messenger, Phone for voice.
export const CHANNEL_META: Record<Channel, ChannelMeta> = {
  whatsapp: { icon: MessageCircle, bg: "bg-emerald-600", label: "WhatsApp" },
  website: { icon: Globe, bg: "bg-violet-600", label: "Website chat" },
  instagram: { icon: Camera, bg: "bg-pink-600", label: "Instagram" },
  facebook: { icon: Send, bg: "bg-blue-600", label: "Messenger" },
  phone: { icon: Phone, bg: "bg-amber-600", label: "Phone" },
};

/**
 * Get stable avatar colour classes (fill and text) based on a name
 * or identifier. Same string always produces the same colour.
 */
export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Soft tint with a strong initial, rather than a saturated disc with white
  // text: a page of forty leads in solid colour reads as confetti on a light
  // background. Each pair clears 4.5:1.
  const colors = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-violet-100 text-violet-700",
    "bg-amber-100 text-amber-800",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-800",
    "bg-indigo-100 text-indigo-700",
    "bg-orange-100 text-orange-800",
  ];
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Initials from a person's name, or last 2 chars of an identifier as
 * fallback. Matches the existing avatar logic in the conversations list.
 */
export function initialsFor(
  name: string | null | undefined,
  fallback: string
): string {
  if (name && name.trim()) {
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return fallback.slice(-2).toUpperCase();
}
