import { describe, expect, it } from "vitest";
import { FILLERS, FillerPicker } from "./fillers";

describe("what fills the pause while a tool runs", () => {
  it("fits what it is doing", () => {
    const p = new FillerPicker();
    expect(FILLERS.check_availability).toContain(p.pick("check_availability"));
    expect(FILLERS.find_appointment).toContain(p.pick("find_appointment"));
    expect(["One moment.", "Bear with me.", "Okay, one sec."]).toContain(p.pick("some_new_tool"));
  });

  it("takes each in turn, so a call does not hear the same one over and over", () => {
    const p = new FillerPicker();
    const said = FILLERS.check_availability.map(() => p.pick("check_availability"));
    expect(new Set(said).size).toBe(FILLERS.check_availability.length);
  });

  it("never says the same one twice running, whatever the tools", () => {
    const p = new FillerPicker();
    const tools = ["check_availability", "find_appointment", "check_availability", "find_appointment", "take_message", "book_callback"];
    let last = "";
    for (let round = 0; round < 6; round++) {
      for (const tool of tools) {
        const line = p.pick(tool);
        expect(line).not.toBe(last);
        last = line;
      }
    }
  });

  it("is a few words, not a reply", () => {
    for (const line of Object.values(FILLERS).flat()) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(7);
    }
  });
});
