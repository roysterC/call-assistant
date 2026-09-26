/**
 * Cuts a reply into speakable pieces as it streams in.
 *
 * Text-to-speech cannot start on half a word, and waiting for the whole reply
 * would add the model's full writing time to the silence the caller hears. A
 * sentence is the natural unit: long enough to be spoken with the right
 * intonation, short enough that the first one is ready almost at once.
 */

/** Below this, a "sentence" is held back to join the next: "Right." then a pause sounds clipped. */
const MIN_CHARS = 12;
/** A run-on reply is cut at a comma rather than waiting indefinitely for a full stop. */
const MAX_CHARS = 160;

/** Words that end in a full stop without ending the sentence. */
const ABBREVIATION = /(?:^|[\s(])(?:mr|mrs|ms|dr|st|rd|ave|approx|e\.g|i\.e)\.$/i;

export class SentenceChunker {
  private buffer = "";

  /** Add streamed text; returns any pieces now complete, in order. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === -1) break;
      const piece = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (piece) out.push(piece);
    }
    return out;
  }

  /** Whatever is left once the reply has finished. */
  flush(): string[] {
    const piece = this.buffer.trim();
    this.buffer = "";
    return piece ? [piece] : [];
  }

  private findCut(): number {
    // End of a sentence: . ! or ? (optionally closing a quote or bracket)
    // followed by whitespace. Requiring the whitespace is what stops "9.30"
    // or "£45.00" being cut in the middle.
    const re = /[.!?]["')\]]?\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buffer))) {
      const end = m.index + m[0].length;
      // "Mrs. Jones", "St. Mary's Road", "e.g. a toner": not the end of anything.
      if (ABBREVIATION.test(this.buffer.slice(0, m.index + 1))) continue;
      if (this.buffer.slice(0, end).trim().length >= MIN_CHARS) return end;
    }
    if (this.buffer.length > MAX_CHARS) {
      const comma = this.buffer.lastIndexOf(", ", MAX_CHARS);
      if (comma > MIN_CHARS) return comma + 2;
    }
    return -1;
  }
}
