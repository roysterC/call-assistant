/**
 * What a call cost us, and what the salon is charged for it.
 *
 * Two audiences, one set of numbers. Super-admins see the cost — what the
 * providers bill us — and the margin. Salon owners see only the charge: the
 * cost with their markup applied. Nothing here decides who sees what; the
 * routes do, and they must never send `cost` to anyone but a super-admin.
 *
 * Money is held as US dollars in millionths ("micros") because the providers
 * bill in dollars and a single call costs fractions of a cent. It is turned
 * into pounds only for display, at a configured rate.
 */

export interface UsageCounts {
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Caller audio sent to the recogniser. */
  sttSeconds?: number;
  /** Characters turned into speech. */
  ttsCharacters?: number;
  telephonySeconds?: number;
}

export interface CostBreakdown {
  llm: number;
  stt: number;
  tts: number;
  telephony: number;
  total: number;
}

/**
 * Model prices, US dollars per million tokens. Cache reads bill at a tenth of
 * input and cache writes (five-minute) at a quarter more, per Anthropic's
 * pricing. An unknown model is priced as Haiku rather than as free, so a
 * setting mistake shows up as a plausible cost, not a zero.
 */
const MODEL_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
};

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && process.env[name]?.trim() ? v : fallback;
}

/** Provider rates in US dollars, each overridable when a price changes. */
export function rates() {
  return {
    // Deepgram Nova-3 streaming, list price per minute.
    sttPerMinute: envNumber("USAGE_RATE_STT_PER_MIN", 0.0077),
    // ElevenLabs Flash v2.5 via the API, per thousand characters.
    ttsPer1kChars: envNumber("USAGE_RATE_TTS_PER_1K_CHARS", 0.05),
    // The phone line itself, per minute; set when step 3 connects Twilio.
    telephonyPerMinute: envNumber("USAGE_RATE_TELEPHONY_PER_MIN", 0),
  };
}

/** Pounds per US dollar, for display. */
export function usdToGbp(): number {
  return envNumber("USD_TO_GBP", 0.78);
}

const toMicros = (usd: number) => Math.round(usd * 1_000_000);

export function costOf(u: UsageCounts): CostBreakdown {
  const price = MODEL_USD_PER_MTOK[u.model ?? ""] ?? MODEL_USD_PER_MTOK["claude-haiku-4-5"];
  const r = rates();
  const llm = toMicros(
    ((u.inputTokens ?? 0) * price.input +
      (u.outputTokens ?? 0) * price.output +
      (u.cacheReadTokens ?? 0) * price.input * 0.1 +
      (u.cacheWriteTokens ?? 0) * price.input * 1.25) /
      1_000_000
  );
  const stt = toMicros(((u.sttSeconds ?? 0) / 60) * r.sttPerMinute);
  const tts = toMicros(((u.ttsCharacters ?? 0) / 1000) * r.ttsPer1kChars);
  const telephony = toMicros(((u.telephonySeconds ?? 0) / 60) * r.telephonyPerMinute);
  return { llm, stt, tts, telephony, total: llm + stt + tts + telephony };
}

/** What the salon is charged for a cost, with its markup. Null when unpriced. */
export function chargeFor(costMicros: number, markupPercent: number | null | undefined): number | null {
  if (markupPercent === null || markupPercent === undefined) return null;
  return Math.round(costMicros * (1 + markupPercent / 100));
}

/** Micros of a dollar to pence, at the display rate. */
export function microsToPence(micros: number, rate = usdToGbp()): number {
  return (micros / 1_000_000) * rate * 100;
}

/**
 * A money figure for the screen. Calls cost pennies and a typed test turn a
 * fraction of one, so small amounts keep their decimals ("0.35p", "4.3p")
 * rather than rounding to nothing.
 */
export function formatPence(pence: number): string {
  if (!Number.isFinite(pence)) return "—";
  const a = Math.abs(pence);
  if (a === 0) return "0p";
  if (a < 1) return `${pence.toFixed(2)}p`;
  if (a < 100) return `${pence.toFixed(a < 10 ? 1 : 0)}p`;
  return `£${(pence / 100).toFixed(2)}`;
}
