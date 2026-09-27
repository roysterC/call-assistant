import { describe, expect, it } from "vitest";
import { answerTo } from "./confirm";

describe("a plain yes or no to the card on screen", () => {
  it("saves on a short, plain yes", () => {
    for (const t of ["Yes", "yeah", "Yep, save it", "yes please", "ok", "That's fine", "sounds good", "all good", "correct", "book it in", "go ahead", "Lovely, thanks"]) {
      expect(answerTo(t), t).toBe("yes");
    }
  });

  it("drops the card on a short, plain no", () => {
    for (const t of ["No", "nope", "no thanks", "cancel that", "scrap it", "forget it", "never mind"]) {
      expect(answerTo(t), t).toBe("no");
    }
  });

  it("leaves anything with a change in it to the assistant", () => {
    for (const t of [
      "yes but with Marcus",
      "yeah make it half two",
      "no, Friday",
      "no not Thursday, Wednesday",
      "yes and add a toner",
      "ok actually 3pm",
      "cancel Sarah's booking on Friday",
      "Sarah Jones cut and finish Thursday at two",
      "that's wrong",
      "that's not right",
      "",
    ]) {
      expect(answerTo(t), t).toBeNull();
    }
  });
});
