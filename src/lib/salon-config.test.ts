import { describe, expect, it } from "vitest";
import {
  constrainWorkingDays,
  describeTeamForPrompt,
  matchService,
  matchStylist,
  parseServices,
  parseStylists,
  serviceIsStaffedOn,
} from "./salon-config";

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

describe("describeTeamForPrompt", () => {
  const SERVICES_2 = parseServices([
    { name: "Cut and finish", durationMinutes: 45, requiresPatchTest: false, bufferMinutes: 0 },
    { name: "Balayage", durationMinutes: 180, requiresPatchTest: true, bufferMinutes: 0 },
  ]);

  const team = (raw: unknown[]) => parseStylists(raw);

  it("names who can be booked, with days and services", () => {
    const out = describeTeamForPrompt(
      team([{ name: "Jo", role: "Owner", googleCalendarId: "jo@x", workingDays: [2, 3], services: ["Balayage"] }]),
      SERVICES_2
    );
    expect(out).toContain("**Jo**");
    expect(out).toContain("Owner");
    expect(out).toContain("Tue, Wed");
    expect(out).toContain("Balayage");
  });

  it("says 'everything' when no services are pinned", () => {
    const out = describeTeamForPrompt(
      team([{ name: "Jo", googleCalendarId: "jo@x", workingDays: [], services: [] }]),
      SERVICES_2
    );
    expect(out).toContain("any day the salon is open");
    expect(out).toContain("everything");
  });

  it("ignores services that no longer exist", () => {
    // Otherwise the agent offers a service the salon removed.
    const out = describeTeamForPrompt(
      team([{ name: "Jo", googleCalendarId: "jo@x", workingDays: [], services: ["Perm"] }]),
      SERVICES_2
    );
    expect(out).not.toContain("Perm");
    expect(out).toContain("everything");
  });

  it("separates stylists who cannot be booked, with what to do instead", () => {
    const out = describeTeamForPrompt(
      team([
        { name: "Jo", googleCalendarId: "jo@x", workingDays: [], services: [] },
        { name: "Marcus", googleCalendarId: "", workingDays: [], services: [] },
      ]),
      SERVICES_2
    );
    expect(out).toContain("**Jo**");
    // Named, but clearly not bookable — a caller can still ask for them.
    expect(out).toContain("Marcus");
    expect(out).toContain("take a");
    expect(out).not.toContain("**Marcus**");
  });

  it("says so plainly when nobody is bookable", () => {
    const out = describeTeamForPrompt(
      team([{ name: "Marcus", googleCalendarId: "", workingDays: [], services: [] }]),
      SERVICES_2
    );
    expect(out).toContain("Nobody can currently be booked");
  });

  it("copes with an empty roster", () => {
    expect(describeTeamForPrompt([], SERVICES_2)).toContain("No stylists");
  });
});

describe("constrainWorkingDays", () => {
  // Shogo trades Sun, Tue, Wed, Fri, Sat. Closed Monday and Thursday.
  const OPEN = [0, 2, 3, 5, 6];

  const team = (workingDays: number[]) =>
    parseStylists([{ name: "Jo", workingDays }]);

  it("drops days the salon is shut", () => {
    const [jo] = constrainWorkingDays(team([2, 3, 4, 5, 6]), OPEN);
    expect(jo.workingDays).toEqual([2, 3, 5, 6]);
  });

  it("drops Monday as readily as Thursday", () => {
    const [jo] = constrainWorkingDays(team([1, 2, 4]), OPEN);
    expect(jo.workingDays).toEqual([2]);
  });

  it("leaves a list that is already inside opening hours alone", () => {
    const before = team([2, 3]);
    const after = constrainWorkingDays(before, OPEN);
    expect(after[0]).toBe(before[0]); // same object, not a rebuilt copy
  });

  it("leaves an empty list empty — that already means any open day", () => {
    const [jo] = constrainWorkingDays(team([]), OPEN);
    expect(jo.workingDays).toEqual([]);
  });

  // The dangerous direction: pruning to [] would read as "works every open
  // day", turning someone who works none of them into someone who works all.
  it("does not turn 'no open days' into 'every open day'", () => {
    const [jo] = constrainWorkingDays(team([1, 4]), OPEN);
    expect(jo.workingDays).toEqual([1, 4]);
  });

  it("constrains nothing when opening hours are unconfigured", () => {
    const before = team([1, 2, 4]);
    expect(constrainWorkingDays(before, [])).toBe(before);
  });
});

describe("serviceIsStaffedOn", () => {
  const cut = matchService("Cut and finish", SERVICES)!;
  const balayage = matchService("Balayage", SERVICES)!;

  // The Shogo case: Jo is on Saturday but only does colour, so a Saturday
  // haircut has nobody — which is not the same as the diary being full.
  const team = parseStylists([
    {
      name: "Jo",
      googleCalendarId: "jo@example.com",
      workingDays: [2, 3, 4, 6],
      services: ["Balayage", "Half head highlights"],
    },
    {
      name: "Shogo",
      googleCalendarId: "shogo@example.com",
      workingDays: [2, 3, 4, 5],
      services: [],
    },
  ]);

  it("is false when the only stylist that day does not do the service", () => {
    expect(serviceIsStaffedOn(cut, team, 6)).toBe(false); // Saturday
  });

  it("is true for a service that stylist does do", () => {
    expect(serviceIsStaffedOn(balayage, team, 6)).toBe(true);
  });

  it("is false when nobody is rostered at all", () => {
    expect(serviceIsStaffedOn(cut, team, 0)).toBe(false); // Sunday
    expect(serviceIsStaffedOn(balayage, team, 0)).toBe(false);
  });

  it("is true on a day both are on", () => {
    expect(serviceIsStaffedOn(cut, team, 3)).toBe(true);
    expect(serviceIsStaffedOn(balayage, team, 3)).toBe(true);
  });

  it("treats an empty services list as every service", () => {
    expect(serviceIsStaffedOn(cut, team, 5)).toBe(true); // Friday, Shogo only
    expect(serviceIsStaffedOn(balayage, team, 5)).toBe(true);
  });

  it("treats an empty workingDays list as every open day", () => {
    const anyDay = parseStylists([
      { name: "Sam", googleCalendarId: "sam@example.com", workingDays: [], services: [] },
    ]);
    expect(serviceIsStaffedOn(cut, anyDay, 0)).toBe(true);
    expect(serviceIsStaffedOn(cut, anyDay, 6)).toBe(true);
  });

  it("ignores a stylist with no calendar, who cannot be booked", () => {
    const noCalendar = parseStylists([
      { name: "Alex", workingDays: [6], services: [] },
    ]);
    expect(serviceIsStaffedOn(cut, noCalendar, 6)).toBe(false);
  });
});
