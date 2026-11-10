import { describe, expect, it } from "vitest";
import { starterServices } from "@/lib/business-types";
import { resumeAt, servicesAfterTypeChange, stepProblem, stepsFor, type OnboardingDraft } from "./onboarding";

const open = { day: 2, closed: false, open: "09:00", close: "17:00" };
const cut = { name: "Cut", durationMinutes: 45, requiresPatchTest: false, priceMinor: 3000 };
const sam = { name: "Sam", workingDays: [], services: [] };

const done: OnboardingDraft = { businessName: "Shears", businessHours: [open], services: [cut], teamMembers: [sam] };
const blank: OnboardingDraft = { businessName: "", businessHours: [], services: [], teamMembers: [] };

describe("stepsFor", () => {
  it("asks about the salon only when something answers customers", () => {
    expect(stepsFor(true)).toEqual(["salon", "hours", "services", "team", "about", "ready"]);
    expect(stepsFor(false)).toEqual(["salon", "hours", "services", "team", "ready"]);
  });
});

describe("stepProblem", () => {
  it("passes a salon that can take bookings", () => {
    for (const step of stepsFor(true)) expect(stepProblem(step, done), step).toBeNull();
  });

  it("says what each step still needs", () => {
    expect(stepProblem("salon", { ...done, businessName: "  " })).toMatch(/name/);
    expect(stepProblem("hours", { ...done, businessHours: [{ ...open, closed: true }] })).toMatch(/at least one day/);
    expect(stepProblem("services", { ...done, services: [] })).toMatch(/at least one service/);
    expect(stepProblem("services", { ...done, services: [{ ...cut, durationMinutes: 0 }] })).toMatch(/how long/);
  });

  it("speaks of the team in the salon's word", () => {
    expect(stepProblem("team", { ...done, teamMembers: [] }, "nail technician")).toBe("Add at least one nail technician.");
  });

  it("lets the about step be skipped, and holds Finish until the diary could book", () => {
    expect(stepProblem("about", blank)).toBeNull();
    expect(stepProblem("ready", { ...done, teamMembers: [] })).toMatch(/can't take bookings yet: no stylists/);
  });
});

describe("resumeAt", () => {
  it("picks up at the first step still to do, never stopping at the optional one", () => {
    expect(resumeAt(stepsFor(true), blank)).toBe("salon");
    expect(resumeAt(stepsFor(true), { ...done, services: [] })).toBe("services");
    expect(resumeAt(stepsFor(true), done)).toBe("ready");
  });
});

describe("servicesAfterTypeChange", () => {
  it("swaps the starter list for the new type's", () => {
    expect(servicesAfterTypeChange(starterServices(["hair"]), ["hair"], ["nails"])).toEqual(starterServices(["nails"]));
    expect(servicesAfterTypeChange([], ["hair"], ["barber"])).toEqual(starterServices(["barber"]));
  });

  it("leaves a list the owner has made their own", () => {
    const edited = starterServices(["hair"]).map((s, i) => (i === 0 ? { ...s, priceMinor: 4500 } : s));
    expect(servicesAfterTypeChange(edited, ["hair"], ["nails"])).toBeNull();
  });

  it("changes nothing when the type has not changed", () => {
    expect(servicesAfterTypeChange(starterServices(["hair"]), ["hair"], ["hair"])).toBeNull();
  });
});
