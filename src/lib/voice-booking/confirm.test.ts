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
      // Too long to be a plain answer, even with nothing but filler in it.
      "yes that is fine thanks great lovely",
    ]) {
      expect(answerTo(t), t).toBeNull();
    }
  });
});

import { yesThenQuestion } from "./confirm";

describe("a yes followed by a question", () => {
  it("splits a plain yes from a question after it", () => {
    expect(yesThenQuestion("Yes. And how much did we take last week?")).toBe("how much did we take last week?");
    expect(yesThenQuestion("Yeah, save it. Who's first in tomorrow?")).toBe("Who's first in tomorrow?");
    expect(yesThenQuestion("Yes please. Any messages?")).toBe("Any messages?");
  });

  it("splits a new request asked as a question, even with a change word in it", () => {
    // A question word leads, so it is a question for the assistant, not a
    // change to the card just saved.
    expect(yesThenQuestion("Yes. Can you move Tom to Friday as well?")).toBe("Can you move Tom to Friday as well?");
  });

  it("splits a question the transcript gave no question mark", () => {
    // Speech to text often leaves the "?" off; the question word is enough.
    expect(yesThenQuestion("Yes. How much did we take last week")).toBe("How much did we take last week");
  });

  it("does not split a change to the card", () => {
    expect(yesThenQuestion("Yes. And add a toner.")).toBeNull();
    expect(yesThenQuestion("Yes, with Marcus instead")).toBeNull();
    expect(yesThenQuestion("No. How about Friday?")).toBeNull();
    expect(yesThenQuestion("Yes")).toBeNull();
    // Said as a question but a change all the same. These reach the
    // change-word rule; the ones above are turned away before it.
    expect(yesThenQuestion("Yes. With Marcus instead?")).toBeNull();
    expect(yesThenQuestion("Yes. Add a toner?")).toBeNull();
  });
});
