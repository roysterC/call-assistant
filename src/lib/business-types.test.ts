import { describe, expect, it } from "vitest";
import type { SalonConfig } from "@/lib/booking";
import { composeVoicePrompt } from "@/lib/receptionist/instructions";
import { buildSystem } from "@/lib/receptionist/prompt";
import { salonFactsForChat } from "@/lib/salon-knowledge";
import { salonKeyterms } from "@/lib/receptionist/voice/keyterms";
import { instructions } from "@/lib/voice-booking/assistant";
import { businessTypesOf, inTradeWords, starterServices, tradeFor } from "./business-types";

/**
 * A hair salon's words, held exactly as they were before business types:
 * these snapshots were taken first, and a hair-only salon must still match
 * them character for character.
 */
const hair = {
  diary: "native",
  timeZone: "Europe/London",
  hours: [
    { day: 2, closed: false, open: "09:00", close: "18:00" },
    { day: 6, closed: false, open: "08:30", close: "17:00" },
  ],
  services: [
    { name: "Ladies cut and blow dry", durationMinutes: 60, requiresPatchTest: false, priceMinor: 4500 },
    { name: "Root tint", durationMinutes: 90, requiresPatchTest: true, priceMinor: 5500 },
    { name: "Yuko straightening", durationMinutes: 180, requiresPatchTest: false, priceMinor: null },
  ],
  stylists: [
    { name: "Jo Bloggs", workingDays: [2, 6], services: [], bookable: true },
    { name: "Siobhan", workingDays: [2], services: ["Root tint"], bookable: true },
  ],
  calComApiKey: null,
  calComEventTypeId: null,
} as unknown as SalonConfig;

describe("a hair salon's words, unchanged by business types", () => {
  it("the receptionist's instructions", () => {
    expect(composeVoicePrompt(hair, "The salon's own words.", "Parking: on the street.").prompt).toMatchSnapshot();
    expect(buildSystem(hair, "Shogo", null, new Date("2026-11-09T10:00:00Z"), "+447700900123")[0].text).toMatchSnapshot();
  });

  it("the chat bots' facts", () => {
    expect(
      salonFactsForChat({ cfg: hair, faq: "Parking: on the street.", businessName: "Shogo", contactPhone: "01234 567890" })
    ).toMatchSnapshot();
  });

  it("the words the phone listens for", () => {
    expect(salonKeyterms({ businessName: "Shogo", stylists: hair.stylists, services: hair.services })).toMatchSnapshot();
  });

  it("the assistant's instructions", () => {
    expect(instructions("Shogo", "Roy (full access)")).toMatchSnapshot();
  });
});

const nails = {
  ...hair,
  services: [
    { name: "Gel manicure", durationMinutes: 45, requiresPatchTest: false, priceMinor: 2500 },
    { name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: 3500 },
  ],
  businessTypes: ["nails"],
} as unknown as SalonConfig;

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
    expect(composeVoicePrompt(hair, null, null).prompt).not.toContain("come in now");
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

describe("a salon that does more than one thing", () => {
  const both = { ...hair, businessTypes: ["hair", "beauty"] } as unknown as SalonConfig;
  const prompt = composeVoicePrompt(both, null, null).prompt;

  it("keeps the main type's word for the team, and adds the other's questions and rules", () => {
    expect(prompt).not.toContain("never stylists");
    expect(prompt).toContain("highlights on the top, half or full head; waxing: which area");
    expect(prompt).toContain("General hair questions, such as what a toner or Olaplex does or how often to have a trim; or beauty questions");
    expect(prompt).toContain("and for colour, lash and brow tints or lash extensions, mention the skin test");
    expect(prompt).toContain("only if they ask whether they can come in now");
  });

  it("listens for both trades' words, in turn", () => {
    const terms = tradeFor(["hair", "beauty"]).keyterms;
    expect(terms.slice(0, 4)).toEqual(["Kérastase", "HD brows", "L'Oréal", "Henna brows"]);
  });
});

describe("the types themselves", () => {
  it("reads a salon's types: main first, once each, hair when unset or unknown", () => {
    expect(businessTypesOf(undefined)).toEqual(["hair"]);
    expect(businessTypesOf("tattoo", ["nails"])).toEqual(["hair", "nails"]);
    expect(businessTypesOf("nails", ["beauty", "nails", "x", "beauty"])).toEqual(["nails", "beauty"]);
  });

  it("rewords only the prompts' own 'stylist', keeping capitals and plurals", () => {
    const t = { staff: "therapist" };
    expect(inTradeWords("Stylists and a stylist; stylistic", t)).toBe("Therapists and a therapist; stylistic");
    expect(inTradeWords("a stylist", { staff: "stylist" })).toBe("a stylist");
  });

  it("starts a new salon with every type's services, unpriced and without skin tests", () => {
    const list = starterServices(["nails", "beauty"]);
    expect(list.map((s) => s.name)).toEqual(expect.arrayContaining(["Gel manicure", "Eyebrow shape"]));
    expect(list.every((s) => s.priceMinor === null && !s.requiresPatchTest)).toBe(true);
  });
});
