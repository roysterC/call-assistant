import { describe, expect, it } from "vitest";
import { MAX_KEYTERMS, salonKeyterms } from "./keyterms";
import { deepgramListenUrl } from "./providers";

describe("salon keyterms", () => {
  it("listens for the salon, its stylists by full and first name, and its services", () => {
    expect(
      salonKeyterms({
        businessName: "Shogo",
        stylists: [{ name: "Siobhan O'Neill" }, { name: "Jo" }],
        services: [{ name: "Balayage" }, { name: "Cut & finish" }],
      })
    ).toEqual(["Shogo", "Siobhan O'Neill", "Siobhan", "Jo", "Balayage", "Cut & finish"]);
  });

  it("tidies names and drops repeats and anything unusable", () => {
    expect(
      salonKeyterms({
        businessName: "  Shogo  Hair ",
        stylists: [{ name: "jo" }, { name: "Jo" }, { name: "(x)" }],
        services: [{ name: "Colour: roots*" }, { name: "a".repeat(80) }, { name: "" }],
      })
    ).toEqual(["Shogo Hair", "jo", "Colour roots"]);
  });

  it("keeps the list short, dropping services before people", () => {
    const terms = salonKeyterms({
      businessName: "Shogo",
      stylists: Array.from({ length: 10 }, (_, i) => ({ name: `Stylist${i}` })),
      services: Array.from({ length: 100 }, (_, i) => ({ name: `Service ${i}` })),
    });
    expect(terms).toHaveLength(MAX_KEYTERMS);
    expect(terms.slice(0, 11)).toEqual(["Shogo", ...Array.from({ length: 10 }, (_, i) => `Stylist${i}`)]);
  });

  it("is empty for a salon with nothing set up", () => {
    expect(salonKeyterms({})).toEqual([]);
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
