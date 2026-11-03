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
  return [head, ...call.lines.map(lineText)].join("\n");
}

function lineText(l: TranscriptLine): string {
  if (l.who !== "tool") return `${l.who === "caller" ? "Caller" : "Receptionist"}: ${l.text}`;
  const r = l.result as { message?: unknown } | null;
  const answer = r && typeof r === "object" && typeof r.message === "string" ? r.message : JSON.stringify(l.result);
  return `    [${l.name} ${JSON.stringify(l.input)}]\n    -> ${clip(answer ?? "", 400)}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
