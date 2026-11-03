import { describe, expect, it } from "vitest";
import { SPOKEN_STYLE, buildSystem, greetingFor } from "./prompt";
import { readBackSentence } from "./read-back";

/**
 * The receptionist talks the way its examples do, whatever the rules say, so
 * the examples are held short here. Callers found it far too wordy.
 */

const cfg = {
  diary: "native",
  timeZone: "Europe/London",
  hours: [{ day: 2, closed: false, open: "09:00", close: "18:00" }],
  services: [{ name: "Blow dry", durationMinutes: 45, bufferMinutes: 0, requiresPatchTest: false, priceMinor: 3000 }],
  stylists: [{ name: "Jo", workingDays: [2], services: [], bookable: true }],
} as unknown as Parameters<typeof buildSystem>[0];

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Every line the instructions give as something to say: *"…"*. */
function examples(text: string): string[] {
  return [...text.matchAll(/\*"([^"]+)"\*/g)].map((m) => m[1].replace(/\s+/g, " "));
}

const prompt = buildSystem(cfg, "Studio", null, new Date("2026-09-26T10:00:00+01:00"), "+447700900715")
  .map((b) => b.text)
  .join("\n");

describe("what the receptionist is shown to say", () => {
  const said = examples(prompt);

  it("has examples to copy", () => {
    expect(said.length).toBeGreaterThan(12);
  });

  it.each(said)("is short: %s", (line) => {
    // The read-back carries a whole booking, so it gets a little more room.
    const limit = line.startsWith("That's a ") ? 22 : 16;
    expect(words(line)).toBeLessThanOrEqual(limit);
  });

  it("uses no filler", () => {
    for (const line of said) {
      expect(line).not.toMatch(/\b(lovely|perfect|great|absolutely|wonderful|happy to help|no problem)\b/i);
    }
  });

  it("tells it to be brief before anything else", () => {
    expect(SPOKEN_STYLE.indexOf("## Be brief")).toBeGreaterThan(-1);
    expect(SPOKEN_STYLE.indexOf("## Be brief")).toBeLessThan(SPOKEN_STYLE.indexOf("## How to say things"));
  });
});

describe("what the caller hears unprompted", () => {
  it("a greeting of a dozen words or fewer", () => {
    expect(words(greetingFor("Studio Hair"))).toBeLessThanOrEqual(12);
  });

  it("a read-back of the booking, with nothing beyond the booking", () => {
    const line = readBackSentence({
      success: true,
      ready: true,
      service: "Wash and blow dry, medium hair",
      stylist: "Chloe",
      startsAt: "2026-10-15T11:00:00+01:00",
      when: "Thursday 15 October at 11am",
      clientName: "Hannah Lee",
      phone: "+447700900715",
      usedCallerId: true,
      patchTestRequired: false,
    });
    expect(words(line)).toBeLessThanOrEqual(18);
  });
});
