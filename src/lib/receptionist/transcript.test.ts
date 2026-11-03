import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { transcriptOf } from "./call-log";
import { transcriptText } from "./transcript-text";

// A call as the engine holds it: the stand-in first turn, the greeting, a
// lookup with its result, and the replies either side.
const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "[The call has connected.]" },
  { role: "assistant", content: "Hi, thanks for calling Shogo. How can I help you today?" },
  { role: "user", content: "Can I get a blow dry Thursday at 3?" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "One moment." },
      { type: "tool_use", id: "t1", name: "check_availability", input: { service: "blow dry", date: "Thursday", time: "3" } },
    ],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ message: "3pm on Thursday is free." }) }],
  },
  { role: "assistant", content: [{ type: "text", text: "Yes, Thursday at three is free. Can I take your name?" }] },
];

describe("the transcript kept for each call", () => {
  it("is who said what, with each tool beside its result, and not the stand-in first turn", () => {
    expect(transcriptOf(messages)).toEqual([
      { who: "receptionist", text: "Hi, thanks for calling Shogo. How can I help you today?" },
      { who: "caller", text: "Can I get a blow dry Thursday at 3?" },
      { who: "receptionist", text: "One moment." },
      {
        who: "tool",
        name: "check_availability",
        input: { service: "blow dry", date: "Thursday", time: "3" },
        result: { message: "3pm on Thursday is free." },
      },
      { who: "receptionist", text: "Yes, Thursday at three is free. Can I take your name?" },
    ]);
  });

  it("keeps a tool's answer that is not JSON as text, and a tool with no answer as null", () => {
    const lines = transcriptOf([
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "take_message", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "plain words" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "b", name: "end_call", input: {} }] },
    ]);
    expect(lines).toEqual([
      { who: "tool", name: "take_message", input: {}, result: "plain words" },
      { who: "tool", name: "end_call", input: {}, result: null },
    ]);
  });

  it("reads as plain text", () => {
    const text = transcriptText({
      id: "c1",
      salon: "Shogo",
      at: new Date("2026-11-03T10:15:00Z"),
      phoneNumber: "+447700900333",
      duration: 74,
      outcomes: ["booked"],
      lines: transcriptOf(messages),
    });
    expect(text).toBe(
      [
        "=== Shogo, 3 Nov 2026, 10:15, +447700900333, 74s, booked (call c1)",
        "Receptionist: Hi, thanks for calling Shogo. How can I help you today?",
        "Caller: Can I get a blow dry Thursday at 3?",
        "Receptionist: One moment.",
        '    [check_availability {"service":"blow dry","date":"Thursday","time":"3"}]',
        "    -> 3pm on Thursday is free.",
        "Receptionist: Yes, Thursday at three is free. Can I take your name?",
      ].join("\n")
    );
  });
});
