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

export type FeatureKey = "voice" | "chatbot" | "whatsapp" | "instagram" | "facebook";

export interface FeatureFlags {
  chatbotEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  instagramEnabled: boolean;
  facebookEnabled: boolean;
}

export interface NavPage {
  href: string;
  label: string;
  /** Shown when ANY of these is switched on for the organisation. */
  requires?: FeatureKey | FeatureKey[];
  /** Owners and super-admins only: it acts on the real diary. */
  ownerOnly?: boolean;
  /** Kikai's own super-admins only: a tool for us, not for the salon. */
  superAdminOnly?: boolean;
}

export const DASHBOARD = "/dashboard";
export const DIARY = "/calendar";

/** In the order the sidebar lists them, before the start page is moved up. */
export const NAV_PAGES: NavPage[] = [
  { href: DASHBOARD, label: "Dashboard" },
  { href: "/calls", label: "Call History", requires: "voice" },
  {
    href: "/conversations",
    label: "Conversations",
    requires: ["chatbot", "whatsapp", "instagram", "facebook"],
  },
  { href: "/websites", label: "Websites", requires: "chatbot" },
  { href: "/insights", label: "Insights", requires: "chatbot" },
  { href: "/leads", label: "Leads" },
  { href: DIARY, label: "Diary", requires: "voice" },
  { href: "/appointments", label: "Appointments", requires: "voice" },
  { href: "/sales", label: "Sales", requires: "voice" },
  { href: "/callbacks", label: "Callbacks", requires: "voice" },
  // Where we test the receptionist before a salon hears it. It books into the
  // real diary and spends on the AI and voice accounts, so it is ours.
  { href: "/receptionist", label: "Receptionist lab", requires: "voice", superAdminOnly: true },
  { href: "/settings", label: "Settings" },
];

/**
 * Pages an organisation may open on. Not Settings or the lab: a start page is
 * where the day's work is.
 */
export const START_PAGE_CHOICES = NAV_PAGES.filter(
  (p) => p.href !== "/settings" && !p.ownerOnly && !p.superAdminOnly
).map((p) => p.href);

export function isStartPageChoice(href: unknown): href is string {
  return typeof href === "string" && START_PAGE_CHOICES.includes(href);
}

/** Whether the organisation's switched-on features show this page. */
export function isNavVisible(page: NavPage, flags: FeatureFlags | null): boolean {
  if (!page.requires) return true;
  // Flags not loaded yet: show nothing feature-gated, rather than flash it.
  if (!flags) return false;
  const reqs = Array.isArray(page.requires) ? page.requires : [page.requires];
  return reqs.some((r) => flags[`${r}Enabled` as keyof FeatureFlags]);
}

/**
 * The page an organisation opens on.
 *
 * Its own choice (Settings → Start page), when that page is one it can see.
 * Otherwise the diary for a salon whose diary takes bookings — that is where
 * a salon's day happens — and the dashboard for everyone else.
 */
export function resolveStartPage(input: {
  chosen: string | null | undefined;
  flags: FeatureFlags;
  diaryTakesBookings: boolean;
}): string {
  const visible = (href: string) => {
    const page = NAV_PAGES.find((p) => p.href === href);
    return Boolean(page && isNavVisible(page, input.flags));
  };
  if (isStartPageChoice(input.chosen) && visible(input.chosen)) return input.chosen;
  if (input.diaryTakesBookings && visible(DIARY)) return DIARY;
  return DASHBOARD;
}

/** The sidebar's order: the start page first, the rest as listed. */
export function orderForStartPage<T extends { href: string }>(pages: T[], startPage: string | null): T[] {
  const first = pages.find((p) => p.href === startPage);
  return first ? [first, ...pages.filter((p) => p !== first)] : pages;
}
