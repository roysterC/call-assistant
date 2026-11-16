/**
 * The CRM's pages, which of them an organisation sees, and which it opens on.
 *
 * Shared by the sidebar, the settings API (which resolves the start page) and
 * the root route (which sends a signed-in user to it), so the page a salon
 * lands on is always one its sidebar shows, at the top.
 *
 * No icons here: this is read on the server too. The sidebar maps each href
 * to its icon.
 */

import type { MessageKey } from "@/lib/i18n";

export type FeatureKey = "voice" | "diary" | "chatbot" | "whatsapp" | "instagram" | "facebook";

export interface FeatureFlags {
  chatbotEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  /** The diary, clients, sales and callbacks: see hasDiary. */
  diaryEnabled: boolean;
  instagramEnabled: boolean;
  facebookEnabled: boolean;
}

/**
 * Whether the salon has the diary: switched on by itself, or by what books
 * into it, the phone receptionist or booking by message. Without this the
 * diary came only with the phone, and a salon booking only by Instagram had
 * nowhere to set up its services and team.
 */
export function hasDiary(s: { diaryEnabled?: boolean | null; voiceEnabled?: boolean | null; chatBookingEnabled?: boolean | null }): boolean {
  return Boolean(s.diaryEnabled || s.voiceEnabled || s.chatBookingEnabled);
}

/** The features a salon's settings switch on, as the menu reads them. */
export function featureFlags(s: {
  chatbotEnabled?: boolean | null;
  whatsappEnabled?: boolean | null;
  voiceEnabled?: boolean | null;
  diaryEnabled?: boolean | null;
  chatBookingEnabled?: boolean | null;
  instagramEnabled?: boolean | null;
  facebookEnabled?: boolean | null;
}): FeatureFlags {
  return {
    chatbotEnabled: Boolean(s.chatbotEnabled),
    whatsappEnabled: Boolean(s.whatsappEnabled),
    voiceEnabled: Boolean(s.voiceEnabled),
    diaryEnabled: hasDiary(s),
    instagramEnabled: Boolean(s.instagramEnabled),
    facebookEnabled: Boolean(s.facebookEnabled),
  };
}

export interface NavPage {
  href: string;
  label: string;
  /** The label in the reader's language (src/lib/i18n). */
  labelKey: MessageKey;
  /** Shown when ANY of these is switched on for the organisation. */
  requires?: FeatureKey | FeatureKey[];
  /**
   * Owners (admin) and super-admins only, never members: the salon's
   * websites and chatbot. The API refuses members too; this keeps the menu
   * from offering them a page that would only show an error.
   */
  ownerOnly?: boolean;
  /** Kikai's own super-admins only: a tool for us, not for the salon. */
  superAdminOnly?: boolean;
}

/** Sends a signed-in user on to their organisation's start page. */
export const START = "/start";
export const DIARY = "/calendar";
const CONVERSATIONS = "/conversations";
const SETTINGS = "/settings";

/** In the order the sidebar lists them. */
export const NAV_PAGES: NavPage[] = [
  {
    href: CONVERSATIONS,
    label: "Conversations", labelKey: "nav.conversations",
    requires: ["chatbot", "whatsapp", "instagram", "facebook"],
  },
  // The receptionist's figures for a salon, the chatbot's for a website.
  { href: "/insights", label: "Insights", labelKey: "nav.insights", requires: ["voice", "chatbot"], ownerOnly: true },
  { href: DIARY, label: "Diary", labelKey: "nav.diary", requires: "diary" },
  { href: "/clients", label: "Clients", labelKey: "nav.clients", requires: "diary" },
  { href: "/sales", label: "Sales", labelKey: "nav.sales", requires: "diary" },
  // Messages taken by the receptionist or by a booking chat.
  { href: "/callbacks", label: "Callbacks", labelKey: "nav.callbacks", requires: "diary" },
  // Where we test the receptionist before a salon hears it. It books into the
  // real diary and spends on the AI and voice accounts, so it is ours.
  { href: "/receptionist", label: "Receptionist lab", labelKey: "nav.receptionist", requires: "voice", superAdminOnly: true },
  { href: SETTINGS, label: "Settings", labelKey: "nav.settings" },
];

/** Whether this login's role may see the page at all. */
export function isNavAllowed(page: NavPage, role: string | null | undefined): boolean {
  if (page.superAdminOnly) return role === "superAdmin";
  if (page.ownerOnly) return role === "admin" || role === "superAdmin";
  return true;
}

/** Whether the organisation's switched-on features show this page. */
export function isNavVisible(page: NavPage, flags: FeatureFlags | null): boolean {
  if (!page.requires) return true;
  // Flags not loaded yet: show nothing feature-gated, rather than flash it.
  if (!flags) return false;
  const reqs = Array.isArray(page.requires) ? page.requires : [page.requires];
  return reqs.some((r) => flags[`${r}Enabled` as keyof FeatureFlags]);
}

/** Whether the menu lists the page for this login in this organisation. */
export function isNavShown(page: NavPage, flags: FeatureFlags | null, role: string | null | undefined): boolean {
  return isNavVisible(page, flags) && isNavAllowed(page, role);
}

/**
 * The page an organisation opens on: the diary for a salon whose diary takes
 * bookings (that is where a salon's day happens), Conversations for an
 * organisation with no diary, and Settings for a salon whose diary is not
 * set up yet. There is no choosing it: the diary is everyone's start page.
 */
export function resolveStartPage(input: { flags: FeatureFlags; diaryTakesBookings: boolean }): string {
  const visible = (href: string) => {
    const page = NAV_PAGES.find((p) => p.href === href);
    return Boolean(page && isNavVisible(page, input.flags));
  };
  if (input.diaryTakesBookings && visible(DIARY)) return DIARY;
  // A diary that cannot take bookings yet has no services or team: Settings
  // is where those are added. Without one, the inbox is the day's work.
  if (!visible(DIARY) && visible(CONVERSATIONS)) return CONVERSATIONS;
  return SETTINGS;
}

/**
 * What a salon owner opens all day: always at the top of the menu, full size.
 * Everything else is one tap further, under More.
 */
export const PRIMARY_PAGES = [DIARY, CONVERSATIONS];

/**
 * The menu in three parts: the pages up front (Diary, then Conversations),
 * the rest under More in their usual order, and Settings, which sits at the
 * foot on its own. An organisation with neither still gets something up
 * front, its first page, so the menu never opens on a bare More.
 */
export function splitNav<T extends { href: string }>(shown: T[]): { primary: T[]; more: T[]; settings: T | null } {
  const settings = shown.find((p) => p.href === SETTINGS) ?? null;
  const pages = shown.filter((p) => p.href !== SETTINGS);
  let primary = PRIMARY_PAGES.flatMap((href) => pages.filter((p) => p.href === href));
  if (primary.length === 0 && pages.length > 0) primary = [pages[0]];
  return { primary, more: pages.filter((p) => !primary.includes(p)), settings };
}
