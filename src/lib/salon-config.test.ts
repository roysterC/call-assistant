import { describe, expect, it } from "vitest";
import { matchService, matchStylist, parseServices, parseStylists } from "./salon-config";

const SERVICES = parseServices([
  { name: "Cut and finish", durationMinutes: 45, requiresPatchTest: false, bufferMinutes: 0 },
  { name: "Fringe trim", durationMinutes: 15, requiresPatchTest: false, bufferMinutes: 0 },
  { name: "Gents cut", durationMinutes: 30, requiresPatchTest: false, bufferMinutes: 0 },
  { name: "Half head highlights", durationMinutes: 120, requiresPatchTest: true, bufferMinutes: 15 },
  { name: "Full head highlights", durationMinutes: 150, requiresPatchTest: true, bufferMinutes: 15 },
  { name: "Balayage", durationMinutes: 180, requiresPatchTest: true, bufferMinutes: 15 },
]);

const name = (spoken: string) => matchService(spoken, SERVICES)?.name ?? null;

describe("matchService", () => {
  it("matches what the caller actually says", () => {
    expect(name("Cut and finish")).toBe("Cut and finish");
    expect(name("cut and finish")).toBe("Cut and finish");
    expect(name("a cut and finish please")).toBe("Cut and finish");
    expect(name("balayage")).toBe("Balayage");
    expect(name("half head highlights")).toBe("Half head highlights");
  });

  it("refuses a match built on one common word", () => {
    // "beard trim" shares only "trim" with "Fringe trim" — half its tokens.
    // Booking that would give someone fifteen minutes for the wrong service.
    expect(name("beard trim")).toBeNull();
    // "cut" alone cannot choose between "Cut and finish" and "Gents cut".
    expect(name("cut")).toBeNull();
  });

  it("refuses when several services are equally plausible", () => {
    // Half head vs full head — the agent must ask which.
    expect(name("highlights")).toBeNull();
  });

  it("returns null rather than guessing on nonsense", () => {
    expect(name("something nice")).toBeNull();
    expect(name("")).toBeNull();
    expect(matchService(undefined, SERVICES)).toBeNull();
  });
});

describe("matchStylist", () => {
  const STYLISTS = parseStylists([
    { name: "Jo", googleCalendarId: "jo@x", workingDays: [], services: [] },
    { name: "Siobhan", googleCalendarId: "s@x", workingDays: [], services: [] },
  ]);

  it("matches on the first name, which is how callers refer to people", () => {
    expect(matchStylist("Jo", STYLISTS)?.name).toBe("Jo");
    expect(matchStylist("siobhan", STYLISTS)?.name).toBe("Siobhan");
  });

  it("returns null for someone who does not work there", () => {
    // Including the transcriber's "Joe" for "Jo" — better to ask than to
    // book with whoever is closest alphabetically.
    expect(matchStylist("Joe", STYLISTS)).toBeNull();
    expect(matchStylist("Bartholomew", STYLISTS)).toBeNull();
  });
});
