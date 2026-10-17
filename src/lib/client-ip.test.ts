import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("takes the address the proxy wrote, not one the client did", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("ignores an X-Real-IP the client sent past Caddy", () => {
    expect(clientIp(new Headers({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("falls back to X-Real-IP when there is no X-Forwarded-For", () => {
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("is null when the proxy says nothing", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": " " }))).toBeNull();
  });
});
