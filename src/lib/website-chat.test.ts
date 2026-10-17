import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_REPLY_CAP, dailyReplyCap, isValidSessionId } from "./website-chat";

describe("isValidSessionId", () => {
  it("takes the widget's own ids", () => {
    expect(isValidSessionId(crypto.randomUUID())).toBe(true);
  });

  it("refuses anything the widget would not send", () => {
    expect(isValidSessionId("")).toBe(false);
    expect(isValidSessionId("short")).toBe(false);
    expect(isValidSessionId("x".repeat(65))).toBe(false);
    expect(isValidSessionId("abc def ghi")).toBe(false);
    expect(isValidSessionId({ id: "0123456789" })).toBe(false);
    expect(isValidSessionId(12345678901)).toBe(false);
  });
});

describe("dailyReplyCap", () => {
  it("defaults when unset or nonsense", () => {
    expect(dailyReplyCap(undefined)).toBe(DEFAULT_DAILY_REPLY_CAP);
    expect(dailyReplyCap("")).toBe(DEFAULT_DAILY_REPLY_CAP);
    expect(dailyReplyCap("lots")).toBe(DEFAULT_DAILY_REPLY_CAP);
    expect(dailyReplyCap("-5")).toBe(DEFAULT_DAILY_REPLY_CAP);
    expect(dailyReplyCap("2.5")).toBe(DEFAULT_DAILY_REPLY_CAP);
  });

  it("takes a whole number from the environment, including zero", () => {
    expect(dailyReplyCap("1000")).toBe(1000);
    expect(dailyReplyCap("0")).toBe(0);
  });
});
