/**
 * Putting the photos a client sent back into the conversation they came in.
 *
 * A photo arrives as a line of text in the thread, "[Sent a photo] caption"
 * (chat-photos.ts photoLine), and is kept as a ChatPhoto row with the same
 * conversation, saved a moment after that line. Nothing joins the two, so
 * each photo goes with the last photo line written before it (one line can
 * carry several: Instagram sends an album as one message). Plain code, no
 * database: used by the conversation API and its tests.
 */

const SAVED = "[Sent a photo]";
const NOT_SAVED = "[Sent a photo that could not be saved]";

/** A small allowance for clocks: the line and the photo are stored within moments of each other. */
const SLACK_MS = 5_000;

export interface PhotoLine {
  /** True when the message is a photo line at all. */
  isPhoto: boolean;
  /** False when the photo could not be downloaded or kept. */
  saved: boolean;
  /** What they wrote with it, if anything. */
  caption: string;
}

/** Whether a message is a photo line, and what was written with it. */
export function readPhotoLine(content: string): PhotoLine {
  if (content.startsWith(NOT_SAVED)) {
    return { isPhoto: true, saved: false, caption: content.slice(NOT_SAVED.length).trim() };
  }
  if (content.startsWith(SAVED)) {
    return { isPhoto: true, saved: true, caption: content.slice(SAVED.length).trim() };
  }
  return { isPhoto: false, saved: false, caption: content };
}

interface Msg {
  id: string;
  role: string;
  content: string;
  createdAt: Date | string;
}

interface Pic {
  id: string;
  createdAt: Date | string;
}

const ms = (d: Date | string) => new Date(d).getTime();

/** Message id → the ids of the photos it carried, oldest first. */
export function photosByMessage(messages: Msg[], photos: Pic[]): Record<string, string[]> {
  const lines = messages
    .filter((m) => m.role === "user" && readPhotoLine(m.content).saved)
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const out: Record<string, string[]> = {};
  if (lines.length === 0) return out;
  for (const p of [...photos].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))) {
    const at = ms(p.createdAt) + SLACK_MS;
    // The last photo line written by then; a photo older than every line
    // (a clock out by more than the slack) goes with the first.
    let line = lines[0];
    for (const l of lines) {
      if (ms(l.createdAt) <= at) line = l;
      else break;
    }
    (out[line.id] ??= []).push(p.id);
  }
  return out;
}
