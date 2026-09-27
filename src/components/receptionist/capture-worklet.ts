/**
 * The microphone, as the voice server wants it: shared by the receptionist
 * lab's Talk tab and booking by voice in the diary.
 */

/** Sample rate sent to the recogniser. */
export const MIC_RATE = 16000;

/**
 * Runs in the audio thread. Averages the microphone down to the rate the
 * recogniser is sent and posts 20ms frames: 16kHz 16-bit samples normally,
 * or 8kHz mu-law bytes, the phone network's own audio, in phone quality.
 */
export const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.mulaw = !!o.mulaw;
    const rate = o.rate || ${MIC_RATE};
    this.step = sampleRate / rate;
    this.next = this.step;
    this.pos = 0; this.sum = 0; this.n = 0;
    this.frame = this.mulaw ? new Uint8Array(rate / 50) : new Int16Array(rate / 50); this.fill = 0;
  }
  encode(v) {
    const s = v < 0 ? v * 0x8000 : v * 0x7fff;
    if (!this.mulaw) return s;
    const sign = s < 0 ? 0x80 : 0;
    const m = Math.min(Math.abs(Math.round(s)), 32635) + 0x84;
    let e = 7;
    for (let mask = 0x4000; (m & mask) === 0 && e > 0; mask >>= 1) e--;
    return ~(sign | (e << 4) | ((m >> (e + 3)) & 0x0f)) & 0xff;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.pos++;
      if (this.pos >= this.next) {
        this.frame[this.fill++] = this.encode(Math.max(-1, Math.min(1, this.sum / this.n)));
        this.sum = 0; this.n = 0; this.next += this.step;
        if (this.fill === this.frame.length) {
          this.port.postMessage(this.frame.buffer.slice(0));
          this.fill = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
`;

