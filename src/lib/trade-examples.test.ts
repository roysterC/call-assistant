import { describe, expect, it } from "vitest";
import { buildChatSystem, buildSystem } from "@/lib/receptionist/prompt";
import { instructions } from "@/lib/voice-booking/assistant";
import { tradeFor, type BusinessType } from "@/lib/business-types";
import { hairExamplesLeft } from "./trade-examples";
import type { SalonConfig } from "@/lib/booking";

const salon = (types: BusinessType[]) =>
  ({
    diary: "native",
    timeZone: "Europe/London",
    hours: [{ day: 4, closed: false, open: "09:00", close: "18:00" }],
    services: [{ name: "Service", durationMinutes: 60, requiresPatchTest: false, priceMinor: 3000 }],
    stylists: [{ name: "Lan", workingDays: [4], services: [], bookable: true }],
    calComApiKey: null,
    calComEventTypeId: null,
    businessTypes: types,
  }) as unknown as SalonConfig;
const now = new Date("2026-11-09T10:00:00Z");
const text = (blocks: { text: string }[]) => blocks.map((b) => b.text).join("\n");

const prompts = (type: BusinessType) => ({
  phone: text(buildSystem(salon([type]), "Salon", null, now, null)),
  chat: text(buildChatSystem(salon([type]), "Salon", "instagram", null, now, null)),
  assistant: instructions("Salon", "Lan", tradeFor([type])),
});

describe("examples in the salon's own trade", () => {
  it.each(["nails", "beauty", "barber"] as const)("%s: no hair example is left anywhere", (type) => {
    for (const [where, t] of Object.entries(prompts(type))) {
      expect(hairExamplesLeft(t, type), `${type} ${where}`).toEqual([]);
    }
  });

  it("a nail salon's read-back, two services, chat and assistant are about nails", () => {
    const { phone, chat, assistant } = prompts("nails");
    expect(phone).toContain("That's a BIAB infill with Lan");
    expect(phone).toContain('"gel manicure and gel pedicure"');
    expect(chat).toContain(`*"Can I book a BIAB?"* You: *"Is that a full set or an infill?"*`);
    expect(chat).toContain(`*"Infill."* You: *"Which day suits you?"*`);
    expect(assistant).toContain("Sarah's BIAB infill at eleven");
    expect(assistant).toContain("walk-in for a gel manicure?");
    expect(assistant).toContain("next gap for an\n  acrylic full set");
    expect(assistant).toContain("what colour did she have?");
    // No skin tests at a nail salon.
    expect(assistant).not.toContain("patch test today");
  });

  it("a beauty salon keeps the skin-test example; a barber does not", () => {
    expect(prompts("beauty").assistant).toContain('"Jo had her patch test today"');
    expect(prompts("barber").assistant).not.toContain("patch test today");
  });

  it("a salon of several types uses its main type's", () => {
    const chat = text(buildChatSystem(salon(["nails", "beauty"]), "Salon", "instagram", null, now, null));
    expect(chat).toContain("Can I book a BIAB?");
  });

  it("a hair salon's chat has hair examples, and no chat has the phone's rule about reading out digits", () => {
    expect(prompts("hair").chat).toContain(`*"Can I book a cut?"*`);
    for (const type of ["hair", "nails"] as const) {
      expect(prompts(type).chat).not.toContain("number they are ringing from");
      expect(prompts(type).phone).toContain("number they are ringing from");
    }
  });
});
