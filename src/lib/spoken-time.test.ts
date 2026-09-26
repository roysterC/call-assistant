import { describe, expect, it } from "vitest";
import { parseSpokenTime } from "./business-hours";

describe("parseSpokenTime", () => {
  const cases: Array<[string, string | null]> = [
    ["14:00", "14:00"],
    ["9:30", "09:30"],
    ["2pm", "14:00"],
    ["2 pm", "14:00"],
    ["2:30pm", "14:30"],
    ["2.30", "14:30"],
    ["10am", "10:00"],
    ["12pm", "12:00"],
    ["12am", "00:00"],
    ["noon", "12:00"],
    ["midday", "12:00"],
    ["9", "09:00"],
    ["2", "14:00"],
    ["ten o'clock", "10:00"],
    ["10 o'clock", "10:00"],
    ["nine thirty", "09:30"],
    ["two fifteen", "14:15"],
    ["four forty-five", "16:45"],
    ["half two", "14:30"],
    ["half past two", "14:30"],
    ["quarter past three", "15:15"],
    ["quarter to four", "15:45"],
    ["ten past eleven", "11:10"],
    ["twenty to one", "12:40"],
    ["five to nine", "08:55"],
    ["half nine in the morning", "09:30"],
    ["seven in the evening", "19:00"],
    ["1400", "14:00"],
    ["25:00", null],
    ["", null],
    ["whenever", null],
    ["11:00 or 12:00", null],
  ];
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input)} → ${want}`, () => expect(parseSpokenTime(input)).toBe(want));
  }
});
