import { describe, expect, it } from "vitest";
import { tradeFor } from "@/lib/business-types";
import { MAX_KEYTERMS, salonKeyterms, serviceWords } from "./keyterms";
import { deepgramListenUrl } from "./providers";

const trade = tradeFor(["nails"]);
const TRADE_TERMS = [...trade.keyterms];

describe("salon keyterms", () => {
  it("listens for the salon, its nail technicians by full and first name, and the unusual words in its services", () => {
    expect(
      salonKeyterms({
        businessName: "Polished",
        stylists: [{ name: "Siobhan O'Neill" }, { name: "Lan" }],
        services: [{ name: "Polygel full set" }, { name: "Gel manicure" }],
        trade,
      })
    ).toEqual(["Polished", "Siobhan O'Neill", "Siobhan", "Lan", "Polygel", ...TRADE_TERMS.filter((t) => t !== "polygel")]);
  });

  it("takes from a service name only the words Deepgram is likely to mishear", () => {
    const own = (name: string) => salonKeyterms({ services: [{ name }], trade }).slice(0, -TRADE_TERMS.length);
    expect(own("Acrylic infill French tip")).toEqual(["Acrylic"]);
    expect(own("Take off & redo, gel colour")).toEqual([]);
    expect(own("Toenail extension")).toEqual([]);
    expect(own("Nail art tier 2")).toEqual([]);
    expect(own("Full pedicure without colour")).toEqual([]);
    expect(serviceWords("Polygel full set")).toEqual(["Polygel"]);
  });

  it("listens for brands before anything else of the trade's, so they are never the ones dropped", () => {
    expect(TRADE_TERMS.slice(0, 3)).toEqual(["BIAB", "Shellac", "OPI"]);
  });

  it("tidies names and drops repeats and anything unusable", () => {
    expect(
      salonKeyterms({
        businessName: "  Polished  Nails ",
        stylists: [{ name: "lan" }, { name: "Lan" }, { name: "(x)" }],
        services: [{ name: "Gel: manicure*" }, { name: "a".repeat(80) }, { name: "" }],
        trade,
      })
    ).toEqual(["Polished Nails", "lan", ...TRADE_TERMS]);
  });

  it("keeps the list short, dropping services before people", () => {
    const terms = salonKeyterms({
      businessName: "Polished",
      stylists: Array.from({ length: 10 }, (_, i) => ({ name: `Tech${i}` })),
      services: Array.from({ length: 100 }, (_, i) => ({ name: `Zumba${i} manicure` })),
      trade,
    });
    expect(terms).toHaveLength(MAX_KEYTERMS);
    expect(terms.slice(0, 11)).toEqual(["Polished", ...Array.from({ length: 10 }, (_, i) => `Tech${i}`)]);
  });

  it("still listens for the trade's words for a salon with nothing set up", () => {
    expect(salonKeyterms({ trade })).toEqual(TRADE_TERMS);
  });

  it("adds the trade's words after the salon's own, without repeating its services", () => {
    const terms = salonKeyterms({ businessName: "Polished", services: [{ name: "Shellac" }, { name: "BIAB infill" }], trade });
    expect(terms.slice(0, 3)).toEqual(["Polished", "Shellac", "BIAB"]);
    expect(terms.filter((t) => t.toLowerCase() === "shellac")).toHaveLength(1);
    expect(terms.filter((t) => t.toLowerCase() === "biab")).toHaveLength(1);
    expect(terms).toContain("soak off");
  });

  it("keeps every trade word within Deepgram's limits", () => {
    expect(TRADE_TERMS.length).toBeLessThan(MAX_KEYTERMS);
    expect(TRADE_TERMS.join("").length).toBeLessThan(1000);
  });
});

describe("Deepgram address", () => {
  it("sends each keyterm to Nova-3", () => {
    const url = new URL(deepgramListenUrl({ kind: "pcm16", sampleRate: 16000 }, { keyterms: ["Polished", "BIAB infill"] }));
    expect(url.searchParams.getAll("keyterm")).toEqual(["Polished", "BIAB infill"]);
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
  });

  it("leaves keyterms off older models, which refuse them", () => {
    const url = new URL(deepgramListenUrl({ kind: "pcm16", sampleRate: 16000 }, { model: "nova-2", keyterms: ["Polished"] }));
    expect(url.searchParams.getAll("keyterm")).toEqual([]);
  });

  it("takes phone audio as it comes: 8kHz mu-law", () => {
    const url = new URL(deepgramListenUrl({ kind: "mulaw8k" }));
    expect(url.searchParams.get("encoding")).toBe("mulaw");
    expect(url.searchParams.get("sample_rate")).toBe("8000");
  });
});
