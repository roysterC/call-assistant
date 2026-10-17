import { describe, expect, it } from "vitest";
import { smsSize, toGsm } from "./sms-encoding";

describe("smsSize", () => {
  it("fits 160 plain characters in one segment, then 153 a segment", () => {
    expect(smsSize("a".repeat(160))).toEqual({ encoding: "GSM-7", length: 160, segments: 1 });
    expect(smsSize("a".repeat(161)).segments).toBe(2);
    expect(smsSize("a".repeat(306)).segments).toBe(2);
    expect(smsSize("a".repeat(307)).segments).toBe(3);
  });

  it("counts £ and accents GSM-7 has as one, and its extension characters as two", () => {
    expect(smsSize("£45 café").length).toBe(8);
    expect(smsSize("€5").length).toBe(3);
    expect(smsSize("a".repeat(159) + "€").segments).toBe(2);
  });

  it("drops to 70 a segment when one character is outside GSM-7", () => {
    const withDash = "Hi Sarah — " + "a".repeat(60);
    expect(smsSize(withDash).encoding).toBe("UCS-2");
    expect(smsSize("a".repeat(70) + "—").segments).toBe(2);
    expect(smsSize("a".repeat(140) + "—").segments).toBe(3);
  });
});

describe("toGsm", () => {
  it("swaps the usual pasted punctuation for plain characters", () => {
    expect(toGsm("Hi Sarah — you’re booked “today”… see you")).toBe(
      `Hi Sarah - you're booked "today"... see you`
    );
    expect(toGsm("10–11am\u00A0with Jo")).toBe("10-11am with Jo");
  });

  it("keeps accents GSM-7 has, and drops the ones it hasn't", () => {
    expect(toGsm("Renée, José, Chloé")).toBe("Renée, José, Chloé");
    expect(toGsm("Zoë and Siobhán")).toBe("Zoe and Siobhan");
  });

  it("drops emoji and tidies the space they leave", () => {
    expect(toGsm("See you soon 😊!")).toBe("See you soon!");
    expect(toGsm("Running late 👩🏽‍🦰 sorry")).toBe("Running late sorry");
    expect(toGsm("Thanks ❤️")).toBe("Thanks");
  });

  it("leaves a name in another script alone rather than mangle it", () => {
    const text = toGsm("Hi 美玲, see you at 2pm");
    expect(text).toBe("Hi 美玲, see you at 2pm");
    expect(smsSize(text).encoding).toBe("UCS-2");
  });

  it("turns a whole typical message into one plain segment", () => {
    const pasted = "Hi Sarah — just a heads-up we’re running 10 minutes late today. Sorry! 🙏 Shogo";
    expect(smsSize(pasted)).toMatchObject({ encoding: "UCS-2", segments: 2 });
    expect(smsSize(toGsm(pasted))).toMatchObject({ encoding: "GSM-7", segments: 1 });
  });
});
