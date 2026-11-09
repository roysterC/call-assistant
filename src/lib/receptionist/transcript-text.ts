import type { TranscriptLine } from "./call-log";

/** A call's transcript as plain text: a header, then who said what, with each tool in between. */
export function transcriptText(call: {
  id: string;
  salon: string;
  at: Date;
  phoneNumber: string;
  duration: number;
  outcomes: string[];
  lines: TranscriptLine[];
}): string {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(call.at);
  const head =
    `=== ${call.salon}, ${when}, ${call.phoneNumber}, ${call.duration}s` +
    (call.outcomes.length ? `, ${call.outcomes.join(", ")}` : "") +
    ` (call ${call.id})`;
  return [head, ...call.lines.map((l) => lineText(l, CALL_LABELS))].join("\n");
}

const CALL_LABELS = { caller: "Caller", receptionist: "Receptionist" };

/** A session with the personal assistant: the same, with the desk speaking. */
export function assistantTranscriptText(s: {
  id: string;
  salon: string;
  at: Date;
  speaker: string | null;
  lines: TranscriptLine[];
}): string {
  const head = `=== ${s.salon}, ${londonTime(s.at)}, ${s.speaker ?? "staff"} (assistant ${s.id})`;
  return [head, ...s.lines.map((l) => lineText(l, { caller: "Staff", receptionist: "Assistant" }))].join("\n");
}

function londonTime(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }).format(at);
}

function lineText(l: TranscriptLine, labels: { caller: string; receptionist: string }): string {
  if (l.who !== "tool") return `${l.who === "caller" ? labels.caller : labels.receptionist}: ${l.text}`;
  const r = l.result as { message?: unknown } | null;
  const answer = r && typeof r === "object" && typeof r.message === "string" ? r.message : JSON.stringify(l.result);
  return `    [${l.name} ${JSON.stringify(l.input)}]\n    -> ${clip(answer ?? "", 400)}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
