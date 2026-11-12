/**
 * The Settings page's tabs (src/app/settings/page.tsx): which a salon has,
 * which one an address opens on, and what setup still needs, with the tab
 * each step is on.
 *
 * Grouped so each tab is one job: the salon's basics, its price list, its
 * people, its online booking, and how it talks to clients.
 */

export type SettingsTab = "salon" | "services" | "team" | "online" | "chats";

export const TAB_LABELS: Record<SettingsTab, string> = {
  salon: "Salon",
  services: "Services",
  team: "Team",
  online: "Online booking",
  chats: "Chats & texts",
};

/**
 * The tabs a salon has, in order. Services and online booking only with a
 * diary, which is what they feed; Team also for an owner without one, for
 * the team's logins.
 */
export function settingsTabs(s: { hasDiary: boolean; canEdit: boolean }): SettingsTab[] {
  const tabs: SettingsTab[] = ["salon"];
  if (s.hasDiary) tabs.push("services");
  if (s.hasDiary || s.canEdit) tabs.push("team");
  if (s.hasDiary) tabs.push("online");
  tabs.push("chats");
  return tabs;
}

/**
 * Anchors from before the tabs, and to sections inside one, that still need
 * to land on the right tab: onboarding links to #team-logins.
 */
const ANCHORS: Record<string, SettingsTab> = {
  hours: "salon",
  "team-logins": "team",
};

/** The tab "#team", "#team-logins" or "#hours" opens on; the first tab for anything else. */
export function tabFromHash(hash: string, available: SettingsTab[]): SettingsTab {
  const key = hash.replace(/^#/, "").trim().toLowerCase();
  const tab = (available as string[]).includes(key) ? (key as SettingsTab) : ANCHORS[key];
  return tab && available.includes(tab) ? tab : available[0];
}

export interface SetupStep {
  key: "services" | "team" | "hours";
  label: string;
  done: boolean;
  tab: SettingsTab;
  /** The section to scroll to on that tab. */
  anchor: string;
}

/**
 * What the diary needs before anything can be booked: the same three things
 * as bookingReadiness (src/lib/booking/readiness.ts), as steps to tick off.
 */
export function setupSteps(s: {
  serviceCount: number;
  teamReady: boolean;
  hoursOpen: boolean;
  staffPlural: string;
}): SetupStep[] {
  return [
    { key: "services", label: "Add your services", done: s.serviceCount > 0, tab: "services", anchor: "price-list" },
    { key: "team", label: `Add your ${s.staffPlural}`, done: s.teamReady, tab: "team", anchor: "people" },
    { key: "hours", label: "Set your opening hours", done: s.hoursOpen, tab: "salon", anchor: "hours" },
  ];
}
