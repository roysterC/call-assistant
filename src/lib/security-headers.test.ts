import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const header = (rules: ReturnType<typeof securityHeaders>, i: number, key: string) =>
  rules[i].headers.find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  const rules = securityHeaders({ voiceUrl: "wss://crm.example/voice" });

  it("keeps the CRM out of other sites' frames", () => {
    expect(header(rules, 0, "X-Frame-Options")).toBe("DENY");
    expect(header(rules, 0, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("lets the chat widget's page be framed by any site, without the microphone", () => {
    expect(rules[1].source).toBe("/embed/:path*");
    expect(header(rules, 1, "X-Frame-Options")).toBeUndefined();
    expect(header(rules, 1, "Content-Security-Policy")).toContain("frame-ancestors *");
    expect(header(rules, 1, "Permissions-Policy")).toContain("microphone=()");
    expect(header(rules, 0, "Permissions-Policy")).toContain("microphone=(self)");
  });

  it("matches every path but the widget's page with the strict rules", () => {
    const strict = new RegExp(`^${rules[0].source.replace("/:path", "/")}$`);
    expect(strict.test("/calendar")).toBe(true);
    expect(strict.test("/")).toBe(true);
    expect(strict.test("/api/settings")).toBe(true);
    expect(strict.test("/embedded-help")).toBe(true);
    expect(strict.test("/embed")).toBe(false);
    expect(strict.test("/embed/x")).toBe(false);
  });

  it("sends HSTS and nosniff everywhere", () => {
    for (const i of [0, 1]) {
      expect(header(rules, i, "Strict-Transport-Security")).toMatch(/max-age=31536000/);
      expect(header(rules, i, "X-Content-Type-Options")).toBe("nosniff");
    }
  });
});

describe("contentSecurityPolicy", () => {
  it("allows the voice server's websocket, however its URL is written", () => {
    expect(contentSecurityPolicy("'none'", { voiceUrl: "wss://crm.example/voice" })).toContain(
      "connect-src 'self' wss://crm.example;"
    );
    expect(contentSecurityPolicy("'none'", { voiceUrl: "https://crm.example/voice" })).toContain(
      "connect-src 'self' wss://crm.example;"
    );
    expect(contentSecurityPolicy("'none'", { voiceUrl: "not a url" })).toContain("connect-src 'self';");
  });

  it("allows eval only in development, and never plugins", () => {
    expect(contentSecurityPolicy("'none'", { dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("'none'")).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("'none'")).toContain("object-src 'none'");
  });

  it("lets the microphone's audio worklet load from a blob: URL", () => {
    // Worklets are checked against script-src; without this the assistant
    // cannot listen.
    expect(contentSecurityPolicy("'none'")).toMatch(/script-src [^;]*blob:/);
  });
});
