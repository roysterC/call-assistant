import { afterEach, describe, expect, it } from "vitest";
import { chargeFor, costOf, formatPence, microsToPence } from "./cost";

afterEach(() => {
  delete process.env.USAGE_RATE_STT_PER_MIN;
  delete process.env.USAGE_RATE_TTS_PER_1K_CHARS;
});

describe("costOf", () => {
  it("prices a typical two-minute call on Haiku, Deepgram and ElevenLabs", () => {
    const c = costOf({
      model: "claude-haiku-4-5",
      inputTokens: 20_000, // $0.02
      outputTokens: 1_000, // $0.005
      cacheReadTokens: 50_000, // $0.005
      cacheWriteTokens: 4_000, // $0.005
      sttSeconds: 120, // 2 min × $0.0077
      ttsCharacters: 1_200, // 1.2k × $0.05
    });
    expect(c.llm).toBe(35_000);
    expect(c.stt).toBe(15_400);
    expect(c.tts).toBe(60_000);
    expect(c.telephony).toBe(0);
    expect(c.total).toBe(110_400); // 11 cents
  });

  it("prices a bigger model higher and an unknown one as Haiku, never as free", () => {
    expect(costOf({ model: "claude-sonnet-5", inputTokens: 1_000_000 }).llm).toBe(2_000_000);
    expect(costOf({ model: "mystery", inputTokens: 1_000_000 }).llm).toBe(1_000_000);
  });

  it("takes a changed provider price from the environment", () => {
    process.env.USAGE_RATE_STT_PER_MIN = "0.0048";
    expect(costOf({ sttSeconds: 60 }).stt).toBe(4_800);
  });
});

describe("chargeFor", () => {
  it("applies the salon's markup, and shows nothing unpriced", () => {
    expect(chargeFor(100_000, 100)).toBe(200_000);
    expect(chargeFor(100_000, 0)).toBe(100_000);
    expect(chargeFor(100_000, null)).toBeNull();
  });
});

describe("display", () => {
  it("converts to pence and keeps small amounts readable", () => {
    expect(microsToPence(110_400, 0.78)).toBeCloseTo(8.61, 2);
    expect(formatPence(8.61)).toBe("8.6p");
    expect(formatPence(43.2)).toBe("43p");
    expect(formatPence(2361)).toBe("£23.61");
    expect(formatPence(0.348)).toBe("0.35p");
    expect(formatPence(0)).toBe("0p");
  });
});
