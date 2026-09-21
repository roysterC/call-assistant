import { describe, expect, it } from "vitest";
import {
  combineServices,
  constrainWorkingDays,
  describeTeamForPrompt,
  matchService,
  matchServices,
  resolveBookedService,
  splitServiceText,
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

/**
 * A caller who asks for two things must get two things in the diary.
 *
 * The live call that prompted this asked for "a haircut and also to dye my
 * hair" and was booked as a colour alone — two hours in the diary for two and
 * a half hours of work, and a cut the client was expecting that nobody had
 * written down.
 */
describe("matchServices", () => {
  const names = (spoken: string) =>
    matchServices(spoken, SERVICES).matched.map((s) => s.name);

  it("keeps a service whose own name contains a separator", () => {
    // The whole reason the whole phrase is tried before anything is split.
    expect(names("Cut and finish")).toEqual(["Cut and finish"]);
    expect(names("cut and finish")).toEqual(["Cut and finish"]);
    expect(names("a cut and finish please")).toEqual(["Cut and finish"]);
  });

  it("finds both services when the caller asks for two", () => {
    expect(names("gents cut and balayage")).toEqual(["Gents cut", "Balayage"]);
    expect(names("balayage and a fringe trim")).toEqual([
      "Balayage",
      "Fringe trim",
    ]);
  });

  it("reads the separators people actually use", () => {
    expect(names("gents cut, balayage")).toEqual(["Gents cut", "Balayage"]);
    expect(names("gents cut + balayage")).toEqual(["Gents cut", "Balayage"]);
    expect(names("gents cut & balayage")).toEqual(["Gents cut", "Balayage"]);
    expect(names("gents cut plus balayage")).toEqual(["Gents cut", "Balayage"]);
  });

  it("rejoins a separator that belonged to a service name", () => {
    // Splits into three fragments, of which the first two only mean anything
    // put back together.
    expect(names("cut and finish and balayage")).toEqual([
      "Cut and finish",
      "Balayage",
    ]);
  });

  it("handles three", () => {
    expect(names("fringe trim, gents cut and balayage")).toEqual([
      "Fringe trim",
      "Gents cut",
      "Balayage",
    ]);
  });

  it("books a service asked for twice only once", () => {
    expect(names("balayage and balayage")).toEqual(["Balayage"]);
  });

  it("reports what it could not place rather than dropping it", () => {
    const r = matchServices("gents cut and a hot stone massage", SERVICES);
    expect(r.matched.map((s) => s.name)).toEqual(["Gents cut"]);
    expect(r.unmatched).toEqual(["a hot stone massage"]);
  });

  it("returns nothing for nothing", () => {
    expect(matchServices("", SERVICES).matched).toEqual([]);
    expect(matchServices(undefined, SERVICES).matched).toEqual([]);
  });
});

describe("combineServices", () => {
  const combined = (spoken: string) =>
    combineServices(matchServices(spoken, SERVICES).matched);

  it("adds the times up", () => {
    // Gents cut 30 + Balayage 180. Booking this as a colour alone loses the
    // half hour the cut needs.
    expect(combined("gents cut and balayage").durationMinutes).toBe(210);
  });

  it("leads with the longest, so the diary reads by the main job", () => {
    expect(combined("gents cut and balayage").name).toBe("Balayage + Gents cut");
  });

  it("carries the patch-test rule in from any part", () => {
    expect(combined("gents cut and balayage").requiresPatchTest).toBe(true);
    expect(combined("gents cut and a fringe trim").requiresPatchTest).toBe(false);
  });

  it("leaves one tidy-up at the end rather than one per service", () => {
    expect(combined("gents cut and balayage").bufferMinutes).toBe(15);
  });

  it("passes a single service through untouched", () => {
    const one = combined("balayage");
    expect(one.name).toBe("Balayage");
    expect(one.durationMinutes).toBe(180);
    expect(one.parts).toHaveLength(1);
  });

  it("adds prices up, but only when every part has one", () => {
    const priced = parseServices([
      { name: "Gents cut", durationMinutes: 30, requiresPatchTest: false, bufferMinutes: 0, priceMinor: 2500 },
      { name: "Balayage", durationMinutes: 180, requiresPatchTest: true, bufferMinutes: 15, priceMinor: 12000 },
      { name: "Fringe trim", durationMinutes: 15, requiresPatchTest: false, bufferMinutes: 0 },
    ]);
    const both = matchServices("gents cut and balayage", priced).matched;
    expect(combineServices(both).priceMinor).toBe(14500);

    // One unpriced part makes the total a guess, and a guess quoted as a
    // total is worse than no total.
    const withUnpriced = matchServices("balayage and a fringe trim", priced).matched;
    expect(combineServices(withUnpriced).priceMinor).toBeNull();
  });
});

describe("splitServiceText", () => {
  it("reverses what combineServices wrote", () => {
    const name = combineServices(
      matchServices("gents cut and balayage", SERVICES).matched
    ).name;
    expect(splitServiceText(name)).toEqual(["Balayage", "Gents cut"]);
  });

  it("returns a single name unchanged", () => {
    expect(splitServiceText("Balayage")).toEqual(["Balayage"]);
    expect(splitServiceText("")).toEqual([]);
  });
});

describe("resolveBookedService", () => {
  it("resolves what it fully understands", () => {
    const r = resolveBookedService("gents cut and balayage", SERVICES);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.service.durationMinutes).toBe(210);
  });

  it("refuses a request it only half understands", () => {
    // Booking the half it recognised is exactly the bug being fixed.
    const r = resolveBookedService("balayage and a hot stone massage", SERVICES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.matched.map((s) => s.name)).toEqual(["Balayage"]);
      expect(r.unmatched).toEqual(["a hot stone massage"]);
    }
  });

  it("refuses what it does not recognise at all", () => {
    const r = resolveBookedService("a hot stone massage", SERVICES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matched).toEqual([]);
  });
});

/**
 * The live call this was written for.
 *
 * The caller asked for "a haircut and also to dye my hair". The agent sent
 * `service: "full head colour"` and the diary got a two hour colour with no
 * cut in it — a stylist half an hour short, and a client expecting work
 * nobody had written down.
 */
describe("the booking that went wrong", () => {
  const SHOGO = parseServices([
    { name: "Haircut", durationMinutes: 45, requiresPatchTest: false, bufferMinutes: 0, priceMinor: 4500 },
    { name: "Full head colour", durationMinutes: 120, requiresPatchTest: true, bufferMinutes: 15, priceMinor: 9500 },
    { name: "Blow dry", durationMinutes: 30, requiresPatchTest: false, bufferMinutes: 0, priceMinor: 3000 },
  ]);

  it("books both, however the caller ordered them", () => {
    for (const spoken of [
      "haircut and full head colour",
      "full head colour and haircut",
      "haircut, full head colour",
    ]) {
      const r = resolveBookedService(spoken, SHOGO);
      expect(r.ok, spoken).toBe(true);
      if (!r.ok) continue;
      expect(r.service.durationMinutes, spoken).toBe(165);
      expect(r.service.name, spoken).toBe("Full head colour + Haircut");
      expect(r.service.requiresPatchTest, spoken).toBe(true);
      expect(r.service.priceMinor, spoken).toBe(14000);
    }
  });

  it("asks rather than booking half, when half is all it can name", () => {
    // The model is meant to turn "dye my hair" into a service name. If it
    // sends the raw phrase instead, the caller must be asked — not given a
    // haircut and nothing else.
    const r = resolveBookedService("haircut and also to dye my hair", SHOGO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.matched.map((s) => s.name)).toEqual(["Haircut"]);
      expect(r.unmatched).toEqual(["to dye my hair"]);
    }
  });
});
