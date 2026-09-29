import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The CRM's "a call comes in" webhook: only Twilio gets an answer, a call is
 * put through to the salon whose number was dialled, and the pass it signs
 * opens a phone call for that salon and nothing else.
 */

const db = vi.hoisted(() => ({ phoneNumber: { findFirst: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { POST } from "@/app/api/twilio/voice/route";
import { twilioSignature } from "./twilio-voice";
import { verifyVoicePass } from "./receptionist/voice/token";

const URL_ = "https://crm.example/api/twilio/voice";
const params = { CallSid: "CA123", From: "+447700900715", To: "+442074317546", CallStatus: "ringing" };

function request(p: Record<string, string>, signature: string | null) {
  return new NextRequest(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signature ? { "x-twilio-signature": signature } : {}),
    },
    body: new URLSearchParams(p).toString(),
  });
}
const signed = (p: Record<string, string>) => request(p, twilioSignature("tok", URL_, p));

beforeEach(() => {
  vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
  vi.stubEnv("RECEPTIONIST_VOICE_URL", "wss://crm.example/voice");
  vi.stubEnv("RECEPTIONIST_VOICE_SECRET", "voice-secret");
  db.phoneNumber.findFirst.mockReset();
  db.phoneNumber.findFirst.mockResolvedValue({ organizationId: "org-shogo", organization: { settings: { voiceEnabled: true } } });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/twilio/voice", () => {
  it("streams the call to the voice server with a phone pass for that salon", async () => {
    const res = await POST(signed(params));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/xml/);
    const body = await res.text();
    expect(body).toMatch(/<Connect><Stream url="wss:\/\/crm\.example\/voice\/phone">/);
    // Looked up by the number dialled, as a voice number.
    expect(db.phoneNumber.findFirst.mock.calls[0][0].where).toEqual({ number: "+442074317546", channel: "vapi", active: true });

    const token = /name="token" value="([^"]+)"/.exec(body)![1];
    const pass = verifyVoicePass(token, "voice-secret");
    expect(pass).toMatchObject({
      organizationId: "org-shogo",
      callerNumber: "+447700900715",
      purpose: "phone",
      callSid: "CA123",
    });
  });

  it("refuses anything Twilio did not sign", async () => {
    expect((await POST(request(params, null))).status).toBe(403);
    expect((await POST(request(params, "forged="))).status).toBe(403);
    // Signed, then changed: another salon's number.
    const tampered = request({ ...params, To: "+441234567890" }, twilioSignature("tok", URL_, params));
    expect((await POST(tampered)).status).toBe(403);
    expect(db.phoneNumber.findFirst).not.toHaveBeenCalled();
  });

  it("refuses everything when no auth token is set", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    expect((await POST(signed(params))).status).toBe(403);
  });

  it("passes a withheld number on as withheld", async () => {
    const body = await (await POST(signed({ ...params, From: "anonymous" }))).text();
    const token = /name="token" value="([^"]+)"/.exec(body)![1];
    expect(verifyVoicePass(token, "voice-secret")?.callerNumber).toBeNull();
  });

  it("apologises and hangs up for a number no salon has, or one without voice", async () => {
    db.phoneNumber.findFirst.mockResolvedValueOnce(null);
    expect(await (await POST(signed(params))).text()).toMatch(/<Say[^>]*>Sorry.*<Hangup\/>/);
    db.phoneNumber.findFirst.mockResolvedValueOnce({ organizationId: "o", organization: { settings: { voiceEnabled: false } } });
    expect(await (await POST(signed(params))).text()).toMatch(/<Hangup\/>/);
  });

  it("uses the forwarded host and scheme, as the web server in front sends them", async () => {
    const p = params;
    const req = new NextRequest("http://127.0.0.1:3000/api/twilio/voice", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https",
        host: "crm.example",
        "x-twilio-signature": twilioSignature("tok", URL_, p),
      },
      body: new URLSearchParams(p).toString(),
    });
    expect((await POST(req)).status).toBe(200);
  });
});
