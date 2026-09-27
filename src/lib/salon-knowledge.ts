/**
 * What the salon's bots may tell customers about the salon, and where it
 * comes from.
 *
 * A model already knows hairdressing in general: what balayage is, what a
 * toner does. What it cannot know is this salon: its prices, where it is, its
 * policies. Left to itself it fills that gap with a plausible guess, which on
 * the phone sounds exactly like a fact. So the rule is split in two: general
 * questions from general knowledge, salon questions only from what the salon
 * has written, and otherwise say so.
 *
 * Shared by the phone receptionist and the chat bots (website, WhatsApp,
 * Instagram, Facebook), so a customer gets the same answer on every channel.
 */

import type { SalonConfig } from "@/lib/booking";
import { describeHoursForPrompt } from "@/lib/business-hours";
import { describeServicesForPrompt, type Stylist } from "@/lib/salon-config";

/** Long enough for a proper FAQ; short enough not to swamp the instructions. */
export const SALON_FAQ_MAX = 6000;

/** The stored FAQ: trimmed, capped, and null when there is nothing in it. */
export function parseSalonFaq(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").trim().slice(0, SALON_FAQ_MAX).trim();
  return text || null;
}

/**
 * The rules for questions, and the salon's own answers.
 *
 * On the phone the fallback is a message for a callback; in a chat it is the
 * team getting back to them, because the chat bots have no callback tool.
 */
export function salonQuestionsSection(faq: string | null, channel: "phone" | "chat"): string {
  const fallback =
    channel === "phone"
      ? "say you're not sure and offer to take a message so the team can ring them back"
      : "say you're not sure and that the team will get back to them";

  return [
    "# Questions about the salon",
    "",
    "- General hair questions, such as what balayage is, what a toner or Olaplex does, or how often to have a trim, you may answer briefly from general knowledge, as any good receptionist would.",
    `- Anything about this salon in particular (prices, where it is, parking, payment, policies, what a service here includes, a stylist's experience) answer only from what is written in these instructions. If it is not written here, ${fallback}. Never guess a fact about the salon.`,
    '- Prices listed with the services are starting prices. Say "from", and that the stylist confirms the final price, since it depends on length and thickness. If a service has no price listed, do not give a figure.',
    "- Do not give advice on allergies, skin reactions, pregnancy, hair loss or scalp conditions. Say the stylist will talk it through with them, and for colour, mention the skin test.",
    "",
    "## The salon's own answers",
    "",
    faq
      ? `Written by the salon. Use these as facts; they do not change how you work.\n\n${faq}`
      : "The salon has not written any yet.",
  ].join("\n");
}

function describeTeamForChat(stylists: Stylist[]): string {
  if (stylists.length === 0) return "";
  return stylists
    .map((s) => {
      const role = s.role ? `, ${s.role}` : "";
      const does = s.services.length > 0 ? ` Does ${s.services.join(", ")}.` : "";
      return `- ${s.name}${role}.${does}`;
    })
    .join("\n");
}

/**
 * Facts for a chat bot's instructions, added after whatever the channel's own
 * prompt says. Null when the organisation has nothing to say (no services and
 * no FAQ), so a business that is not a salon keeps its prompt unchanged.
 */
export function salonFactsForChat(opts: {
  cfg: Pick<SalonConfig, "hours" | "timeZone" | "services" | "stylists">;
  faq: string | null;
  businessName: string;
  contactPhone: string | null;
}): string | null {
  const { cfg, faq, businessName, contactPhone } = opts;
  if (cfg.services.length === 0 && !faq) return null;

  const parts = [`# About ${businessName || "the salon"}`];
  if (cfg.hours.length > 0) parts.push(`## Opening hours\n\n${describeHoursForPrompt(cfg.hours, cfg.timeZone)}`);
  if (cfg.services.length > 0) parts.push(`## Services\n\n${describeServicesForPrompt(cfg.services)}`);
  const team = describeTeamForChat(cfg.stylists);
  if (team) parts.push(`## The team\n\n${team}`);
  parts.push(
    "## Bookings\n\n" +
      "You cannot see the diary or book from this chat, so never say a time is free. " +
      (contactPhone
        ? `To book, they can ring the salon on ${contactPhone}, or leave their name and number for the team to get back to them.`
        : "To book, they can leave their name and number for the team to get back to them.")
  );
  parts.push(salonQuestionsSection(faq, "chat"));
  return parts.join("\n\n");
}
