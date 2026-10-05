import { afterEach, describe, expect, it, vi } from "vitest";
import { clientDevBypassEnabled, devBypassEnabled } from "./dev-bypass";

afterEach(() => vi.unstubAllEnvs());

describe("dev login bypass", () => {
  it("works in local development when asked for", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_BYPASS_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_DEV_BYPASS_AUTH", "1");
    expect(devBypassEnabled()).toBe(true);
    expect(clientDevBypassEnabled()).toBe(true);
  });

  it("never switches on in a production build, even with the variables set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_BYPASS_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_DEV_BYPASS_AUTH", "1");
    expect(devBypassEnabled()).toBe(false);
    expect(clientDevBypassEnabled()).toBe(false);
  });

  it("is off unless asked for", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_BYPASS_AUTH", "");
    vi.stubEnv("NEXT_PUBLIC_DEV_BYPASS_AUTH", "");
    expect(devBypassEnabled()).toBe(false);
    expect(clientDevBypassEnabled()).toBe(false);
  });
});
