import { describe, expect, it } from "vitest";
import type { SalonConfig } from "@/lib/booking";
import { composeVoicePrompt } from "@/lib/receptionist/instructions";
import { buildSystem } from "@/lib/receptionist/prompt";
import { salonFactsForChat } from "@/lib/salon-knowledge";
import { salonKeyterms } from "@/lib/receptionist/voice/keyterms";
import { instructions } from "@/lib/voice-booking/assistant";
import { businessTypesOf, inTradeWords, starterServices, tradeFor } from "./business-types";

/** A nail salon's words, held as snapshots: changes to them show in review. */
const salon = {
  diary: "native",
  timeZone: "Europe/London",
  hours: [
    { day: 2, closed: false, open: "09:00", close: "18:00" },
    { day: 6, closed: false, open: "08:30", close: "17:00" },
  ],
  services: [
    { name: "Gel manicure", durationMinutes: 45, requiresPatchTest: false, priceMinor: 2500 },
    { name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: 3500 },
    { name: "Acrylic full set", durationMinutes: 75, requiresPatchTest: false, priceMinor: null },
  ],
  stylists: [
    { name: "Jo Bloggs", workingDays: [2, 6], services: [], bookable: true },
    { name: "Lan", workingDays: [2], services: ["BIAB infill"], bookable: true },
  ],
  calComApiKey: null,
  calComEventTypeId: null,
} as unknown as SalonConfig;

describe("a nail salon's words, as snapshots", () => {
  it("the receptionist's instructions", () => {
    expect(composeVoicePrompt(salon, "The salon's own words.", "Parking: on the street.").prompt).toMatchSnapshot();
    expect(buildSystem(salon, "Polished", null, new Date("2026-11-09T10:00:00Z"), "+447700900123")[0].text).toMatchSnapshot();
  });

  it("the chat bots' facts", () => {
    expect(
      salonFactsForChat({ cfg: salon, faq: "Parking: on the street.", businessName: "Polished", contactPhone: "01234 567890" })
    ).toMatchSnapshot();
  });

  it("the words the phone listens for", () => {
    expect(
      salonKeyterms({ businessName: "Polished", stylists: salon.stylists, services: salon.services, trade: tradeFor(["nails"]) })
    ).toMatchSnapshot();
  });

  it("the assistant's instructions", () => {
    expect(instructions("Polished", "Roy (full access)")).toMatchSnapshot();
  });
});

// Saved as hair before the nails-only change: still a nail salon.
const nails = { ...salon, businessTypes: ["hair"] } as unknown as SalonConfig;

describe("a nail salon's words", () => {
  const prompt = composeVoicePrompt(nails, "Their own stylist words stay.", null).prompt;

  it("calls the team nail technicians, and leaves the salon's own words alone", () => {
    expect(prompt).toContain("Do not name the nail technician");
    expect(prompt).toContain("The team are nail technicians: call them that, never stylists.");
    expect(prompt).toContain("Their own stylist words stay.");
    const ours = prompt.replace("Their own stylist words stay.", "").replace(/never stylists|The tools' "stylist"/g, "");
    expect(ours).not.toMatch(/stylist/i);
  });

  it("gives prices as \"from\", for the nail trade's reason", () => {
    expect(prompt).toContain('Say "from", and that the nail technician confirms the final price, since nail art and designs are priced individually.');
    expect(prompt).not.toContain("length and thickness");
  });

  it("asks nail questions, and answers walk-ins only when asked", () => {
    expect(prompt).toContain("(nails: gel, acrylic or BIAB; a new set or an infill; hands, feet or both)");
    expect(prompt).toContain("only if they ask whether they can come in now");
  });

  it("listens for nail words, not hairdressing ones, and not for everyday ones", () => {
    const terms = salonKeyterms({ businessName: "Polished", services: nails.services, trade: tradeFor(["nails"]) });
    expect(terms).toEqual(expect.arrayContaining(["Polished", "BIAB", "Shellac", "infill"]));
    expect(terms).not.toContain("Olaplex");
    expect(terms).not.toContain("manicure");
  });

  it("is said in the phone style and the assistant's instructions too", () => {
    expect(buildSystem(nails, "Polished", null, new Date("2026-11-09T10:00:00Z"), null)[0].text).toContain(
      "not who the nail technician is when they did not"
    );
    const desk = instructions("Polished", "Lan", tradeFor(["nails"]));
    expect(desk).toContain("The business is a nail salon.");
    expect(desk).toContain('The team are nail technicians; the tools\' "stylist" means the same person.');
  });
});

describe("the types themselves", () => {
  it("reads every salon as a nail salon, whatever was saved before", () => {
    expect(businessTypesOf(undefined)).toEqual(["nails"]);
    expect(businessTypesOf("hair", ["beauty"])).toEqual(["nails"]);
    expect(businessTypesOf("nails", ["nails", "x"])).toEqual(["nails"]);
    expect(tradeFor(["hair" as never]).staff).toBe("nail technician");
  });

  it("rewords only the prompts' own 'stylist', keeping capitals and plurals", () => {
    const t = { staff: "therapist" };
    expect(inTradeWords("Stylists and a stylist; stylistic", t)).toBe("Therapists and a therapist; stylistic");
    expect(inTradeWords("a stylist", { staff: "stylist" })).toBe("a stylist");
  });

  it("starts a new salon with a nail price list, priced only where the menu was, without skin tests", () => {
    const list = starterServices(["nails"]);
    expect(list.length).toBeGreaterThan(0);
    expect(list.filter((s) => s.priceMinor !== null).every((s) => s.extra)).toBe(true);
    expect(list.some((s) => s.requiresPatchTest)).toBe(false);
  });

  it("rebooks a new set as an infill that is on the same list", () => {
    const list = starterServices(["nails"]);
    const names = new Set(list.map((s) => s.name));
    expect(names.size).toBe(list.length);
    for (const s of list.filter((x) => x.rebookAs)) expect(names.has(s.rebookAs!)).toBe(true);
  });
});
