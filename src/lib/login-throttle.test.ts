import { describe, expect, it } from "vitest";
import {
  LoginThrottle,
  MAX_FAILURES_PER_EMAIL,
  MAX_FAILURES_PER_IP,
  WINDOW_MS,
  clientIp,
} from "./login-throttle";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("LoginThrottle", () => {
  it("stops an address after too many wrong passwords", () => {
    const c = clock();
    const th = new LoginThrottle(c.now);
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      expect(th.allowed("a@x.com", "1.1.1.1")).toBe(true);
      th.fail("a@x.com", "1.1.1.1");
    }
    expect(th.allowed("a@x.com", "2.2.2.2")).toBe(false);
    // Someone else, from the same place, is not affected yet.
    expect(th.allowed("b@x.com", "1.1.1.1")).toBe(true);
  });

  it("lets them try again once the window has passed", () => {
    const c = clock();
    const th = new LoginThrottle(c.now);
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) th.fail("a@x.com", null);
    expect(th.allowed("a@x.com", null)).toBe(false);
    c.advance(WINDOW_MS + 1);
    expect(th.allowed("a@x.com", null)).toBe(true);
  });

  it("stops one IP guessing across many addresses", () => {
    const th = new LoginThrottle(clock().now);
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) th.fail(`u${i}@x.com`, "1.1.1.1");
    expect(th.allowed("new@x.com", "1.1.1.1")).toBe(false);
    expect(th.allowed("new@x.com", "2.2.2.2")).toBe(true);
  });

  it("does not count every login together when the IP is unknown", () => {
    const th = new LoginThrottle(clock().now);
    for (let i = 0; i < MAX_FAILURES_PER_IP * 2; i++) th.fail(`u${i}@x.com`, null);
    expect(th.allowed("new@x.com", null)).toBe(true);
  });

  it("clears an address's count on a correct password", () => {
    const th = new LoginThrottle(clock().now);
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL - 1; i++) th.fail("a@x.com", null);
    th.succeed("a@x.com");
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL - 1; i++) th.fail("a@x.com", null);
    expect(th.allowed("a@x.com", null)).toBe(true);
  });
});

describe("clientIp", () => {
  it("prefers X-Real-IP", () => {
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
  });

  it("takes the entry nginx appended, not one the client wrote", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("is null when the proxy says nothing", () => {
    expect(clientIp(new Headers())).toBeNull();
  });
});
