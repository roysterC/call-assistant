import { describe, expect, it } from "vitest";
import { readCouldNotBook } from "./callback-notes";

describe("a callback for a booking the diary refused", () => {
  it("reads why, and what they wanted", () => {
    expect(
      readCouldNotBook(
        "COULD NOT BOOK: the diary is full then\nWanted: BIAB infill with Lan at 2026-11-20T15:00:00.000Z\nShort squoval please"
      )
    ).toEqual({
      reason: "the diary is full then",
      service: "BIAB infill",
      stylist: "Lan",
      startsAt: "2026-11-20T15:00:00.000Z",
      rest: "Short squoval please",
    });
  });

  it("keeps the rest when the wanted line is not there", () => {
    expect(readCouldNotBook("COULD NOT BOOK: calendar error\nThey'd like Thursday")).toMatchObject({
      reason: "calendar error",
      service: null,
      rest: "They'd like Thursday",
    });
  });

  it("is nothing for an ordinary message", () => {
    expect(readCouldNotBook("Wants a gift voucher")).toBeNull();
    expect(readCouldNotBook(null)).toBeNull();
  });
});
