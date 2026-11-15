import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSmsSender, textsStatus } from "./sms-sender";
import { textFailureKey } from "./text-failure";

const db = vi.hoisted(() => ({
  smsRow: null as { number: string; smsSenderId: string | null } | null,
  salonSender: null as string | null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    phoneNumber: { findFirst: async () => db.smsRow },
    organizationSettings: { findUnique: async () => ({ smsSender: db.salonSender }) },
  },
}));

import { sendSms, smsStatus } from "./sms";

describe("a salon's text sender, as typed in Admin", () => {
  it("takes a name of up to 11 letters, numbers and spaces", () => {
    expect(parseSmsSender("HOANG NAILS")).toEqual({ ok: true, value: "HOANG NAILS" });
    expect(parseSmsSender("  Shogo ")).toEqual({ ok: true, value: "Shogo" });
  });

  it("refuses one the networks would not, saying why", () => {
    expect(parseSmsSender("HOANG NAILS UK")).toMatchObject({ ok: false, reason: expect.stringContaining("11") });
    expect(parseSmsSender("Hoang's")).toMatchObject({ ok: false });
    expect(parseSmsSender("12345")).toMatchObject({ ok: false });
  });

  it("takes a number, in international form, and blank as none", () => {
    expect(parseSmsSender("07700 900123")).toEqual({ ok: true, value: "+447700900123" });
    expect(parseSmsSender("")).toEqual({ ok: true, value: null });
    expect(parseSmsSender(null)).toEqual({ ok: true, value: null });
  });
});

describe("whether a salon's texts can go", () => {
  it("uses its own texting number, then the name set in Admin, then the shared default", () => {
    expect(textsStatus({ configured: true, smsNumber: "+447700900999", salonSender: "HOANG", defaultSender: "KIKAI" }).sender).toBe(
      "+447700900999"
    );
    expect(textsStatus({ configured: true, salonSender: "HOANG", defaultSender: "KIKAI" }).sender).toBe("HOANG");
    expect(textsStatus({ configured: true, defaultSender: "KIKAI" }).sender).toBe("KIKAI");
  });

  it("says when there is no sender, and when texts are not set up at all", () => {
    expect(textsStatus({ configured: true })).toEqual({ ready: false, sender: null, problem: "no_sender" });
    expect(textsStatus({ configured: false, salonSender: "HOANG" })).toMatchObject({ ready: false, problem: "not_configured" });
  });
});

describe("sending, with the sender from Admin", () => {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    void init;
    return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
  });
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "t";
    delete process.env.TWILIO_DEFAULT_SENDER;
    db.smsRow = null;
    db.salonSender = null;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends from the salon's own name", async () => {
    db.salonSender = "HOANG NAILS";
    const r = await sendSms("org", "07700 900123", "Hi");
    expect(r).toMatchObject({ ok: true, sender: "HOANG NAILS" });
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("From")).toBe("HOANG NAILS");
  });

  it("fails without one, with the reason the CRM explains", async () => {
    const r = await sendSms("org", "07700 900123", "Hi");
    expect(r).toMatchObject({ ok: false, reason: "No SMS sender configured for this organization" });
    expect(textFailureKey(r.ok ? null : r.reason)).toBe("textFail.noSender");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await smsStatus("org")).toMatchObject({ ready: false, problem: "no_sender" });
  });
});

describe("why a text did not go, in words", () => {
  it("knows our own reasons and Twilio's common ones", () => {
    expect(textFailureKey("Twilio credentials are not set")).toBe("textFail.notConfigured");
    expect(textFailureKey("That number is not a mobile, so it cannot receive a text.")).toBe("textFail.notMobile");
    expect(textFailureKey("There is no number to text.")).toBe("textFail.noNumber");
    expect(
      textFailureKey("The number +447700900123 is unverified. Trial accounts cannot send messages to unverified numbers")
    ).toBe("textFail.trial");
    expect(textFailureKey("Attempt to send to unsubscribed recipient")).toBe("textFail.optedOut");
    expect(textFailureKey("The 'To' number +4412 is not a valid phone number.")).toBe("textFail.invalid");
    expect(textFailureKey("fetch failed")).toBe("textFail.network");
  });

  it("leaves one it does not know to be shown as it is", () => {
    expect(textFailureKey("Something new from Twilio")).toBeNull();
    expect(textFailureKey(null)).toBeNull();
  });
});
