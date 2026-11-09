import { describe, expect, it } from "vitest";
import { assistantTranscriptText, transcriptText } from "./transcript-text";

const lines = [
  { who: "caller" as const, text: "Who's in first tomorrow?" },
  { who: "tool" as const, name: "day_schedule", input: { date: "tomorrow" }, result: { message: "Jo at 9." } },
  { who: "receptionist" as const, text: "Jo, at nine." },
];

describe("transcripts as text", () => {
  it("labels a phone call caller and receptionist", () => {
    const t = transcriptText({ id: "c1", salon: "Shogo", at: new Date("2026-11-09T10:00:00Z"), phoneNumber: "+447700900123", duration: 42, outcomes: [], lines });
    expect(t).toContain("Caller: Who's in first tomorrow?");
    expect(t).toContain("Receptionist: Jo, at nine.");
  });

  it("labels an assistant session staff and assistant, with who was speaking", () => {
    const t = assistantTranscriptText({ id: "s1", salon: "Shogo", at: new Date("2026-11-09T10:00:00Z"), speaker: "Roy (full access)", lines });
    expect(t.split("\n")[0]).toBe("=== Shogo, 9 Nov 2026, 10:00, Roy (full access) (assistant s1)");
    expect(t).toContain("Staff: Who's in first tomorrow?");
    expect(t).toContain("    [day_schedule {\"date\":\"tomorrow\"}]\n    -> Jo at 9.");
    expect(t).toContain("Assistant: Jo, at nine.");
  });
});
