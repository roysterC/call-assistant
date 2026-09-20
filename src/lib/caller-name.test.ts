import { describe, expect, it } from "vitest";
import { nameRequiredMessage, normaliseCallerName } from "./caller-name";

function name(input: string | null | undefined): string | null {
  const r = normaliseCallerName(input);
  return r.ok ? r.name : null;
}

describe("normaliseCallerName", () => {
  it("takes a name the transcriber got right", () => {
    expect(name("Sarah")).toBe("Sarah");
    expect(name("Sarah Jones")).toBe("Sarah Jones");
  });

  it("capitalises the lower-case text min_latency returns", () => {
    expect(name("sarah jones")).toBe("Sarah Jones");
    expect(name("anne-marie")).toBe("Anne-Marie");
    expect(name("o'brien")).toBe("O'Brien");
  });

  it("leaves casing the caller's own when there is any", () => {
    // Guessing at these does more harm than leaving them: a name database is
    // the only thing that gets McDonald right, and we have not got one.
    expect(name("McDonald")).toBe("McDonald");
    expect(name("van Dijk")).toBe("van Dijk");
  });

  it("collapses the whitespace a transcript arrives with", () => {
    expect(name("  Sarah   Jones \n")).toBe("Sarah Jones");
  });

  it("strips the lead-in the caller actually says", () => {
    expect(name("my name is Sarah")).toBe("Sarah");
    expect(name("It's Sarah")).toBe("Sarah");
    expect(name("I'm Sarah Jones")).toBe("Sarah Jones");
    expect(name("this is Sarah")).toBe("Sarah");
    expect(name("hi it's Sarah")).toBe("Sarah");
  });

  it("does not eat a name that merely starts like a lead-in", () => {
    expect(name("Hilary")).toBe("Hilary");
    expect(name("Ito")).toBe("Ito");
    expect(name("Imogen")).toBe("Imogen");
  });

  it("reassembles a name spelled out letter by letter", () => {
    expect(name("S-A-R-A-H")).toBe("Sarah");
    expect(name("S A R A H")).toBe("Sarah");
    expect(name("s a r a h")).toBe("Sarah");
  });

  it("does not mistake an initial for a spelling", () => {
    expect(name("J Smith")).toBe("J Smith");
    expect(name("A B")).toBe("A B");
  });

  it("drops the punctuation a transcriber adds", () => {
    expect(name("Sarah.")).toBe("Sarah");
    expect(name("Sarah!")).toBe("Sarah");
    expect(name("...Sarah?")).toBe("Sarah");
  });

  // The failure mode that making the parameter required creates: a model that
  // must produce a name and has not got one reaches for a filler.
  it("refuses the fillers a model invents under pressure", () => {
    for (const filler of [
      "Unknown",
      "unknown caller",
      "Customer",
      "the caller",
      "N/A",
      "none",
      "No name",
      "not given",
      "Guest",
      "Anonymous",
      "TBC",
      "test",
      "null",
      "undefined",
    ]) {
      expect(name(filler), filler).toBeNull();
    }
  });

  it("refuses a blank", () => {
    expect(name("")).toBeNull();
    expect(name("   ")).toBeNull();
    expect(name(null)).toBeNull();
    expect(name(undefined)).toBeNull();
    expect(name("!?.")).toBeNull();
  });

  it("refuses a lead-in with no name behind it", () => {
    expect(name("my name is")).toBeNull();
    expect(name("hello")).toBeNull();
  });

  it("refuses a phone number that landed in the name field", () => {
    expect(name("07760 124523")).toBeNull();
    expect(name("Sarah 2")).toBeNull();
  });

  it("refuses a single letter", () => {
    expect(name("S")).toBeNull();
    expect(name("S.")).toBeNull();
  });

  it("refuses a sentence", () => {
    expect(name("she did not say what her name was")).toBeNull();
    expect(name("a".repeat(81))).toBeNull();
  });

  it("keeps a long but plausible name", () => {
    expect(name("Maria Del Carmen Rodriguez")).toBe("Maria Del Carmen Rodriguez");
  });

  it("explains itself to the model rather than to a person", () => {
    const r = normaliseCallerName("Unknown");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msg = nameRequiredMessage(r.reason);
      expect(msg).toContain("spell it out");
      expect(msg).toContain("cannot book");
    }
  });
});
