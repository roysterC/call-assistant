import { describe, expect, it } from "vitest";
import { contactNumberForTexts, normalisePhone, speakablePhone } from "./phone";

const ok = (input: string) => {
  const r = normalisePhone(input);
  if (!r.ok) throw new Error(`expected ${input} to normalise: ${r.reason}`);
  return r;
};

describe("normalisePhone", () => {
  it("normalises the shapes a transcriber produces", () => {
    for (const input of [
      "07760124523",
      "07760 124523",
      "0776 012 4523",
      "+447760124523",
      "+44 7760 124523",
      "447760124523",
      "00447760124523",
      "(07760) 124523",
    ]) {
      expect(ok(input).e164).toBe("+447760124523");
    }
  });

  it("identifies mobiles", () => {
    expect(ok("07760124523").isMobile).toBe(true);
    expect(ok("02079460958").isMobile).toBe(false);
  });

  it("accepts London and other landlines", () => {
    expect(ok("02079460958").e164).toBe("+442079460958");
    expect(ok("01632960123").e164).toBe("+441632960123");
  });

  it("gives back a national form for reading aloud", () => {
    expect(ok("+447760124523").national).toBe("07760124523");
  });

  describe("rejections", () => {
    it("rejects the over-long number from the test call", () => {
      // "071234567189" — twelve digits, one too many. Stored silently, this
      // becomes an SMS that never arrives.
      const r = normalisePhone("071234567189");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("too long");
    });

    it("rejects a number that is too short", () => {
      const r = normalisePhone("0776012");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("too short");
    });

    it("rejects an impossible UK prefix", () => {
      const r = normalisePhone("0576012452");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("does not start with");
    });

    it("rejects nothing, and non-numbers", () => {
      expect(normalisePhone("").ok).toBe(false);
      expect(normalisePhone(undefined).ok).toBe(false);
      expect(normalisePhone("sorry what").ok).toBe(false);
    });
  });

  it("passes through a plausible international number untouched", () => {
    expect(ok("+33612345678").e164).toBe("+33612345678");
  });

  it("still rejects an implausible international number", () => {
    expect(normalisePhone("+1").ok).toBe(false);
  });
});

describe("speakablePhone", () => {
  it("groups digits so they can be read back", () => {
    expect(speakablePhone("+447760124523")).toBe("07760 124523");
  });

  it("returns the input unchanged when it cannot parse", () => {
    expect(speakablePhone("nonsense")).toBe("nonsense");
  });
});

describe("contactNumberForTexts", () => {
  it("keeps the salon's number as they write it, spacing tidied", () => {
    expect(contactNumberForTexts("0161 496 0000")).toEqual({ ok: true, value: "0161 496 0000" });
    expect(contactNumberForTexts("  020  7946 0000 ")).toEqual({ ok: true, value: "020 7946 0000" });
    expect(contactNumberForTexts("+44 7700 900123")).toEqual({ ok: true, value: "+44 7700 900123" });
  });

  it("treats blank as no number, so the texts leave the line out", () => {
    expect(contactNumberForTexts("")).toEqual({ ok: true, value: null });
    expect(contactNumberForTexts("   ")).toEqual({ ok: true, value: null });
    expect(contactNumberForTexts(null)).toEqual({ ok: true, value: null });
  });

  it("refuses something nobody could ring", () => {
    expect(contactNumberForTexts("0161 49").ok).toBe(false);
    expect(contactNumberForTexts("call the salon").ok).toBe(false);
    expect(contactNumberForTexts(1234).ok).toBe(false);
  });
});
