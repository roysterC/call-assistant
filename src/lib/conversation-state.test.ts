import { describe, expect, it } from "vitest";
import { REPLY_GRACE_MS, conversationState } from "./conversation-state";

/** Where a chat stands in the Conversations list: needs you, Kikai is handling, or done. */

const NOW = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("conversationState", () => {
  it("needs you when the client has waited past Kikai's usual reply time", () => {
    expect(conversationState({ lastRole: "user", lastMessageAt: ago(5 * MIN), now: NOW })).toEqual({ group: "you", kind: "waiting" });
  });

  it("leaves a message just sent to Kikai, which is answering it", () => {
    expect(conversationState({ lastRole: "user", lastMessageAt: ago(REPLY_GRACE_MS - 1000), now: NOW })).toEqual({
      group: "bot",
      kind: "replying",
    });
  });

  it("needs you once staff take a website chat over, whoever spoke last", () => {
    expect(conversationState({ lastRole: "assistant", lastMessageAt: ago(HOUR), handoffState: "human", now: NOW })).toEqual({
      group: "you",
      kind: "staff",
    });
  });

  it("is done with a booking made in the conversation, and says what and when", () => {
    const s = conversationState({
      lastRole: "assistant",
      lastMessageAt: ago(HOUR),
      booking: { createdAt: ago(HOUR + 2 * MIN), service: "BIAB infill", startsAt: new Date("2026-11-14T14:30:00Z") },
      callback: { createdAt: ago(HOUR), pending: false },
      now: NOW,
    });
    expect(s).toEqual({ group: "done", kind: "booked", booking: { service: "BIAB infill", startsAt: "2026-11-14T14:30:00.000Z" } });
  });

  it("needs you while a message Kikai took is waiting for the team", () => {
    expect(
      conversationState({ lastRole: "assistant", lastMessageAt: ago(HOUR), callback: { createdAt: ago(HOUR + MIN), pending: true }, now: NOW })
    ).toEqual({ group: "you", kind: "callback", since: ago(HOUR + MIN).toISOString() });
  });

  it("still needs you for that message after a booking in the same chat", () => {
    const s = conversationState({
      lastRole: "assistant",
      lastMessageAt: ago(HOUR),
      booking: { createdAt: ago(HOUR + 2 * MIN), service: "Cut", startsAt: NOW },
      callback: { createdAt: ago(HOUR), pending: true },
      now: NOW,
    });
    expect(s.kind).toBe("callback");
  });

  it("is done once the message has been dealt with", () => {
    expect(
      conversationState({ lastRole: "assistant", lastMessageAt: ago(HOUR), callback: { createdAt: ago(HOUR + MIN), pending: false }, now: NOW })
    ).toEqual({ group: "done", kind: "message" });
  });

  it("ignores a booking or callback from an earlier conversation with the same person", () => {
    const s = conversationState({
      lastRole: "assistant",
      lastMessageAt: ago(HOUR),
      booking: { createdAt: ago(5 * 24 * HOUR), service: "Cut", startsAt: ago(4 * 24 * HOUR) },
      callback: { createdAt: ago(3 * 24 * HOUR), pending: true },
      now: NOW,
    });
    expect(s).toEqual({ group: "bot", kind: "bot" });
  });

  it("puts a client waiting first, even after a booking", () => {
    const s = conversationState({
      lastRole: "user",
      lastMessageAt: ago(10 * MIN),
      booking: { createdAt: ago(20 * MIN), service: "Cut", startsAt: NOW },
      now: NOW,
    });
    expect(s.kind).toBe("waiting");
  });

  it("is done when staff answered last, and Kikai's otherwise", () => {
    expect(conversationState({ lastRole: "agent", lastMessageAt: ago(HOUR), now: NOW }).kind).toBe("replied");
    expect(conversationState({ lastRole: "assistant", lastMessageAt: ago(HOUR), now: NOW })).toEqual({ group: "bot", kind: "bot" });
    expect(conversationState({ lastRole: null, lastMessageAt: ago(HOUR), now: NOW }).group).toBe("bot");
  });
});

describe("a quote waiting for a price", () => {
  it("needs you, whatever else the chat did, until it is sent", () => {
    const asked = ago(5 * 60_000);
    expect(
      conversationState({ lastRole: "assistant", lastMessageAt: ago(60_000), quote: { createdAt: asked, designs: 3 }, now: NOW })
    ).toEqual({ group: "you", kind: "quote", since: asked.toISOString(), designs: 3 });
  });
});
