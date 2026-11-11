import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionEmail, escapeHtml, sendEmail } from "./email";

/** Email through Resend, and the one shape of message the app sends. */

const msg = { to: "a@b.co", subject: "Hi", text: "Hello", html: "<p>Hello</p>" };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Kikai <no-reply@example.test>");
});
afterEach(() => vi.unstubAllEnvs());

describe("sendEmail", () => {
  it("posts to Resend with the key, the sender and the message", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    expect(await sendEmail(msg, fetchImpl as unknown as typeof fetch)).toEqual({ ok: true, id: "e1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "Kikai <no-reply@example.test>", to: ["a@b.co"], subject: "Hi" });
  });

  it("reports a refusal without passing Resend's words on", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail(msg, fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, error: "The email could not be sent." });
  });

  it("without a key, logs in development and refuses in production", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchImpl = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    expect(await sendEmail(msg, fetchImpl as unknown as typeof fetch)).toEqual({ ok: true, id: null });
    vi.stubEnv("NODE_ENV", "production");
    expect(await sendEmail(msg, fetchImpl as unknown as typeof fetch)).toMatchObject({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("actionEmail", () => {
  it("escapes what it is given, and writes the link out in the text", () => {
    const e = actionEmail({
      to: "a@b.co",
      subject: "s",
      heading: "Join <Salon & Co>",
      lines: ["Hi"],
      button: "Go",
      url: "https://app.test/x?a=1&b=2",
      footer: "f",
    });
    expect(e.html).toContain("Join &lt;Salon &amp; Co&gt;");
    expect(e.html).not.toContain("<Salon");
    expect(e.text).toContain("Go: https://app.test/x?a=1&b=2");
  });

  it("escapeHtml covers quotes too", () => {
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});
