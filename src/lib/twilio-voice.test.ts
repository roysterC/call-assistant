import { describe, expect, it } from "vitest";
import {
  callerFromTwilio,
  clearFrame,
  mediaFrames,
  parseTwilioFrame,
  sayAndHangUpTwiml,
  streamTwiml,
  twilioSignature,
  validTwilioSignature,
} from "./twilio-voice";

describe("Twilio's request signature", () => {
  // The worked example in Twilio's "Webhook security" documentation. If this
  // drifts, every real call is refused, so it is pinned to Twilio's own value.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
  };

  it("matches Twilio's documented example", () => {
    expect(twilioSignature("12345", url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("accepts Twilio's signature and nothing else", () => {
    expect(validTwilioSignature("12345", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
    // Another number, another URL, another token, or none at all.
    expect(validTwilioSignature("12345", url, { ...params, To: "+18005550000" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(validTwilioSignature("12345", "https://evil.example/myapp.php?foo=1&bar=2", params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(validTwilioSignature("54321", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(validTwilioSignature("12345", url, params, null)).toBe(false);
    expect(validTwilioSignature("", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
  });
});

describe("TwiML", () => {
  it("streams the call to the voice server with the pass as a parameter", () => {
    const x = streamTwiml("wss://crm.example/voice/phone", { token: 'a.b"<c>&' });
    expect(x).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://crm.example/voice/phone">' +
        '<Parameter name="token" value="a.b&quot;&lt;c&gt;&amp;"/></Stream></Connect></Response>'
    );
  });

  it("says sorry and hangs up when the line cannot be answered", () => {
    expect(sayAndHangUpTwiml("Sorry & goodbye.")).toMatch(/<Say[^>]*>Sorry &amp; goodbye\.<\/Say><Hangup\/>/);
  });
});

describe("the caller's number", () => {
  it("is E.164, or null when withheld", () => {
    expect(callerFromTwilio("+447700900123")).toBe("+447700900123");
    for (const withheld of ["anonymous", "Restricted", "", null, undefined]) expect(callerFromTwilio(withheld)).toBeNull();
  });
});

describe("the media stream", () => {
  it("reads the start frame, with the pass, and the caller's audio", () => {
    expect(
      parseTwilioFrame(
        JSON.stringify({
          event: "start",
          streamSid: "MZ1",
          start: { streamSid: "MZ1", callSid: "CA1", customParameters: { token: "t" } },
        })
      )
    ).toEqual({ event: "start", streamSid: "MZ1", callSid: "CA1", customParameters: { token: "t" } });
    const audio = Buffer.from([0xff, 0x7f, 0x00]);
    expect(
      parseTwilioFrame(JSON.stringify({ event: "media", media: { track: "inbound", payload: audio.toString("base64") } }))
    ).toEqual({ event: "media", audio });
    expect(parseTwilioFrame(JSON.stringify({ event: "stop" }))).toEqual({ event: "stop" });
  });

  it("ignores our own voice coming back, and junk", () => {
    expect(parseTwilioFrame(JSON.stringify({ event: "media", media: { track: "outbound", payload: "AA==" } }))).toEqual({
      event: "other",
    });
    expect(parseTwilioFrame("not json")).toBeNull();
  });

  it("sends audio in pieces Twilio can play as it arrives, losing nothing", () => {
    const audio = Buffer.alloc(7000, 0x55);
    const frames = mediaFrames("MZ1", audio).map((f) => JSON.parse(f));
    expect(frames.map((f) => Buffer.from(f.media.payload, "base64").length)).toEqual([3200, 3200, 600]);
    expect(frames.every((f) => f.event === "media" && f.streamSid === "MZ1")).toBe(true);
    expect(Buffer.concat(frames.map((f) => Buffer.from(f.media.payload, "base64")))).toEqual(audio);
    expect(JSON.parse(clearFrame("MZ1"))).toEqual({ event: "clear", streamSid: "MZ1" });
  });
});
