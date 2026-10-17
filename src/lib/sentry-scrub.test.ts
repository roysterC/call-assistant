import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/node";
import { scrubEvent, scrubText } from "./sentry-scrub";

describe("scrubText", () => {
  it("takes out phone numbers and emails, and leaves ordinary text", () => {
    expect(scrubText("Twilio refused +44 7700 900123 and 07700900123")).toBe("Twilio refused [number] and [number]");
    expect(scrubText("lead jo.bloggs@example.co.uk exists")).toBe("lead [email] exists");
    expect(scrubText("Booking 1042 at 14:30 on 2026-10-18")).toBe("Booking 1042 at 14:30 on 2026-10-18");
  });
});

describe("scrubEvent", () => {
  it("strips what could identify a client or a login", () => {
    const event = scrubEvent({
      type: undefined,
      message: "texting 07700 900123",
      exception: { values: [{ type: "Error", value: "jo@example.com not found" }] },
      request: {
        url: "https://crm.example/clients?search=jo",
        query_string: "search=jo",
        cookies: { "__Secure-authjs.session-token": "secret" },
        data: { phone: "07700900123" },
        headers: { cookie: "a=b", authorization: "Bearer x", "user-agent": "Safari" },
      },
      breadcrumbs: [
        { category: "navigation", data: { from: "/clients?search=jo@example.com", to: "/calendar" } },
        { category: "console", data: { arguments: [{ message: "failed for +44 7700 900123" }] } },
      ],
      extra: { note: "call 07700 900123" },
    } as ErrorEvent);

    expect(event.message).toBe("texting [number]");
    expect(event.exception!.values![0].value).toBe("[email] not found");
    expect(event.request!.url).toBe("https://crm.example/clients");
    expect(event.request!.query_string).toBe("[removed]");
    expect(event.request!.cookies).toBeUndefined();
    expect(event.request!.data).toBeUndefined();
    expect(event.request!.headers).toEqual({ "user-agent": "Safari" });
    expect(JSON.stringify(event)).not.toMatch(/7700|jo@example|search=/);
  });
});
