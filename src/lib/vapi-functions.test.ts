import { describe, expect, it } from "vitest";
import { callerNumberFromVapiPayload } from "./vapi-functions";

/**
 * The payload shape varies by event and by which tool format the assistant is
 * configured with, and getting it wrong is silent: the number comes back null,
 * the fallback never runs, and the agent asks the caller to read out the
 * number it is already being rung from. Each shape below is one Vapi actually
 * sends.
 */
describe("callerNumberFromVapiPayload", () => {
  const number = "+447700900123";

  it("reads it from a server-URL function call", () => {
    expect(
      callerNumberFromVapiPayload({
        message: {
          type: "function-call",
          functionCall: { name: "book_appointment", parameters: {} },
          call: { customer: { number } },
        },
      })
    ).toBe(number);
  });

  it("reads it from a toolCallList payload", () => {
    expect(
      callerNumberFromVapiPayload({
        message: {
          toolCallList: [{ function: { name: "book_appointment", arguments: "{}" } }],
          call: { customer: { number } },
        },
      })
    ).toBe(number);
  });

  it("reads it when the call sits at the root", () => {
    expect(
      callerNumberFromVapiPayload({ call: { customer: { number } } })
    ).toBe(number);
  });

  it("reads it when the customer sits beside the message", () => {
    expect(
      callerNumberFromVapiPayload({ message: { customer: { number } } })
    ).toBe(number);
  });

  it("returns null for a web call, which has no number to ring from", () => {
    expect(
      callerNumberFromVapiPayload({
        message: { type: "function-call", call: { assistantId: "a1" } },
      })
    ).toBeNull();
  });

  it("returns null rather than a blank that would pass a truthiness check", () => {
    expect(
      callerNumberFromVapiPayload({ message: { call: { customer: { number: "" } } } })
    ).toBeNull();
    expect(
      callerNumberFromVapiPayload({ message: { call: { customer: { number: "   " } } } })
    ).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(
      callerNumberFromVapiPayload({
        message: { call: { customer: { number: 447700900123 } } },
      })
    ).toBeNull();
    expect(
      callerNumberFromVapiPayload({ message: { call: { customer: null } } })
    ).toBeNull();
  });

  it("survives a payload with nothing in it", () => {
    expect(callerNumberFromVapiPayload({})).toBeNull();
  });
});
