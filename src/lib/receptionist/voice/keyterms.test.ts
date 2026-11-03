import { describe, expect, it } from "vitest";
import { HAIRDRESSING_TERMS, MAX_KEYTERMS, salonKeyterms, serviceWords } from "./keyterms";
import { deepgramListenUrl } from "./providers";

describe("salon keyterms", () => {
  it("listens for the salon, its stylists by full and first name, and the unusual words in its services", () => {
    expect(
      salonKeyterms({
        businessName: "Shogo",
        stylists: [{ name: "Siobhan O'Neill" }, { name: "Jo" }],
        services: [{ name: "Yuko straightening" }, { name: "Cut & finish" }],
      })
    ).toEqual(["Shogo", "Siobhan O'Neill", "Siobhan", "Jo", "Yuko", ...HAIRDRESSING_TERMS]);
  });

  it("takes from a service name only the words Deepgram is likely to mishear", () => {
    expect(serviceWords("Wash and blow dry, medium hair")).toEqual([]);
    expect(serviceWords("Children's cut age 0 to 6")).toEqual([]);
    expect(serviceWords("Yuko straightening")).toEqual(["Yuko"]);
    expect(serviceWords("Olaplex treatment")).toEqual(["Olaplex"]);
    expect(serviceWords("Keratin treatment")).toEqual(["Keratin"]);
    expect(serviceWords("Hair up / party style")).toEqual([]);
  });

  it("listens for brands before anything else of the trade's, so they are never the ones dropped", () => {
    expect(HAIRDRESSING_TERMS.slice(0, 4)).toEqual(["Kérastase", "L'Oréal", "Wella", "Redken"]);
  });

  it("tidies names and drops repeats and anything unusable", () => {
    expect(
      salonKeyterms({
        businessName: "  Shogo  Hair ",
        stylists: [{ name: "jo" }, { name: "Jo" }, { name: "(x)" }],
        services: [{ name: "Colour: roots*" }, { name: "a".repeat(80) }, { name: "" }],
      })
    ).toEqual(["Shogo Hair", "jo", ...HAIRDRESSING_TERMS]);
  });

  it("keeps the list short, dropping services before people", () => {
    const terms = salonKeyterms({
      businessName: "Shogo",
      stylists: Array.from({ length: 10 }, (_, i) => ({ name: `Stylist${i}` })),
      services: Array.from({ length: 100 }, (_, i) => ({ name: `Zumba${i} treatment` })),
    });
    expect(terms).toHaveLength(MAX_KEYTERMS);
    expect(terms.slice(0, 11)).toEqual(["Shogo", ...Array.from({ length: 10 }, (_, i) => `Stylist${i}`)]);
  });

  it("still listens for the trade's words for a salon with nothing set up", () => {
    expect(salonKeyterms({})).toEqual(HAIRDRESSING_TERMS);
  });

  it("adds the trade's words after the salon's own, without repeating its services", () => {
    const terms = salonKeyterms({ businessName: "Shogo", services: [{ name: "Balayage" }, { name: "Blow Dry" }] });
    expect(terms.slice(0, 2)).toEqual(["Shogo", "Balayage"]);
    expect(terms.filter((t) => t.toLowerCase() === "balayage")).toHaveLength(1);
    expect(terms.filter((t) => t.toLowerCase() === "blow dry")).toHaveLength(1);
    expect(terms).toContain("patch test");
  });

  it("keeps every trade word within Deepgram's limits", () => {
    expect(HAIRDRESSING_TERMS.length).toBeLessThan(MAX_KEYTERMS);
    expect(HAIRDRESSING_TERMS.join("").length).toBeLessThan(1000);
  });
});

describe("Deepgram address", () => {
  it("sends each keyterm to Nova-3", () => {
    const url = new URL(deepgramListenUrl({ kind: "pcm16", sampleRate: 16000 }, { keyterms: ["Shogo", "Cut & finish"] }));
    expect(url.searchParams.getAll("keyterm")).toEqual(["Shogo", "Cut & finish"]);
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
  });

  it("leaves keyterms off older models, which refuse them", () => {
    const url = new URL(deepgramListenUrl({ kind: "pcm16", sampleRate: 16000 }, { model: "nova-2", keyterms: ["Shogo"] }));
    expect(url.searchParams.getAll("keyterm")).toEqual([]);
  });

  it("takes phone audio as it comes: 8kHz mu-law", () => {
    const url = new URL(deepgramListenUrl({ kind: "mulaw8k" }));
    expect(url.searchParams.get("encoding")).toBe("mulaw");
    expect(url.searchParams.get("sample_rate")).toBe("8000");
  });
});
