/**
 * What the receptionist is told, for our own engine.
 *
 * The salon-specific rules are the same generated prompt the Vapi assistant
 * gets (`composeVoicePrompt`): booking stance, caller-identity rules, closing,
 * hours, services and team. Our engine adds what Vapi's platform otherwise
 * supplies — that it is speaking down a phone line — and the time of day.
 *
 * Split into two system blocks on purpose. The first never changes within a
 * call and carries the cache marker, so every turn after the first reads the
 * instructions and tools from cache. The clock goes in the second, after the
 * marker, because a timestamp inside the cached prefix would invalidate it
 * every single turn.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SalonConfig } from "@/lib/booking";
import { composeVoicePrompt } from "@/lib/vapi-assistant";

export const SPOKEN_STYLE = `# You are on the phone

You are the receptionist answering the phone for {{business}}. Everything you
write is turned straight into speech and played down a phone line, so write the
way a good receptionist talks.

- Keep each reply short: usually one or two sentences, and one question at a time.
- No lists, headings, bullet points, emojis or symbols. Nobody can hear formatting.
- Say times the way people say them: "half past two", "eleven o'clock", "quarter to five".
- Say prices in words: "forty-five pounds". Read phone numbers back in small groups.
- When you need to look something up, say a few words first, such as
  "Let me just check that for you", and then use the tool.
- If the caller asks for something you cannot help with, say so plainly and
  offer to take their details so the salon can ring them back.`;

export function buildSystem(
  cfg: SalonConfig,
  businessName: string,
  body: string | null,
  now: Date,
  callerNumber: string | null
): Anthropic.TextBlockParam[] {
  const composed = composeVoicePrompt(cfg, body);
  const stable = [
    SPOKEN_STYLE.replace("{{business}}", businessName || "the salon"),
    composed.prompt,
  ].join("\n\n---\n\n");

  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const context = [
    `# This call`,
    ``,
    `It is ${clock} at the salon.`,
    callerNumber
      ? `The caller's number came through on caller ID. The tools know it; you do not need to ask for it unless they want to use a different one.`
      : `The caller's number is withheld, so you will need to ask for it.`,
  ].join("\n");

  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: context },
  ];
}

/** The first thing the caller hears. Says the call is recorded, every time. */
export function greetingFor(businessName: string): string {
  const name = businessName?.trim() || "the salon";
  return `Thank you for calling ${name}. Just so you know, calls are recorded. How can I help?`;
}
