import { describe, expect, it } from "vitest";
import { settingsTabs, setupSteps, tabFromHash } from "./settings-tabs";

describe("the Settings tabs", () => {
  it("a salon with a diary has all five, in order", () => {
    expect(settingsTabs({ hasDiary: true, canEdit: true })).toEqual(["salon", "services", "team", "online", "chats"]);
  });

  it("without a diary: the salon, its logins and its chats", () => {
    expect(settingsTabs({ hasDiary: false, canEdit: true })).toEqual(["salon", "team", "chats"]);
    expect(settingsTabs({ hasDiary: false, canEdit: false })).toEqual(["salon", "chats"]);
  });

  it("opens on the tab an address names, or an anchor on it", () => {
    const all = settingsTabs({ hasDiary: true, canEdit: true });
    expect(tabFromHash("#services", all)).toBe("services");
    expect(tabFromHash("#team-logins", all)).toBe("team");
    expect(tabFromHash("#hours", all)).toBe("salon");
    expect(tabFromHash("", all)).toBe("salon");
    expect(tabFromHash("#nonsense", all)).toBe("salon");
    // A tab this salon does not have: the first instead.
    expect(tabFromHash("#online", ["salon", "team", "chats"])).toBe("salon");
  });
});

describe("what setup still needs", () => {
  it("lists the three things bookings need, each on its tab", () => {
    const steps = setupSteps({ serviceCount: 8, teamReady: true, hoursOpen: false, staffPlural: "nail technicians" });
    expect(steps.map((s) => [s.key, s.done, s.tab])).toEqual([
      ["services", true, "services"],
      ["team", true, "team"],
      ["hours", false, "salon"],
    ]);
    expect(steps[1].label).toBe("Add your nail technicians");
  });
});
