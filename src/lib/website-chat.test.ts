import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_REPLY_CAP, chatOriginAllowed, dailyReplyCap, isValidSessionId, ownChatHosts } from "./website-chat";

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

describe("chatOriginAllowed", () => {
  const base = { requestHost: "app.getkikai.com", ownHosts: ["app.getkikai.com", "book.getkikai.com"] };

  it("checks the page the widget is on, not the widget's own address", () => {
    const allowedOrigins = ["https://salon.co.uk"];
    const widget = { ...base, origin: "https://app.getkikai.com", allowedOrigins };
    expect(chatOriginAllowed({ ...widget, hostOrigin: "https://salon.co.uk" })).toBe(true);
    expect(chatOriginAllowed({ ...widget, hostOrigin: "https://salon.co.uk/prices?x=1" })).toBe(true);
    expect(chatOriginAllowed({ ...widget, hostOrigin: "https://elsewhere.com" })).toBe(false);
    expect(chatOriginAllowed({ ...widget, hostOrigin: undefined })).toBe(false);
  });

  it("always allows this app's own pages, such as a salon's booking page", () => {
    const widget = { ...base, origin: "https://book.getkikai.com", allowedOrigins: ["https://salon.co.uk"] };
    expect(chatOriginAllowed({ ...widget, hostOrigin: "https://book.getkikai.com" })).toBe(true);
    expect(chatOriginAllowed({ ...widget, hostOrigin: "https://app.getkikai.com" })).toBe(true);
  });

  it("allows anywhere when the site has no list", () => {
    expect(chatOriginAllowed({ ...base, origin: "https://app.getkikai.com", hostOrigin: "https://x.com", allowedOrigins: [] })).toBe(true);
  });

  it("checks other callers by their Origin, as before", () => {
    const p = { ...base, hostOrigin: "https://salon.co.uk", allowedOrigins: ["https://salon.co.uk"] };
    expect(chatOriginAllowed({ ...p, origin: "https://salon.co.uk" })).toBe(true);
    expect(chatOriginAllowed({ ...p, origin: "https://evil.example" })).toBe(false);
    expect(chatOriginAllowed({ ...p, origin: null })).toBe(false);
  });
});

describe("ownChatHosts", () => {
  it("reads the app's and the booking address's hostnames", () => {
    expect(ownChatHosts({ AUTH_URL: "https://app.getkikai.com", BOOKING_URL: "https://book.getkikai.com/" })).toEqual([
      "app.getkikai.com",
      "book.getkikai.com",
    ]);
    expect(ownChatHosts({})).toEqual([]);
  });
});
