import { describe, expect, it } from "vitest";
import { STYLIST_COLOURS, stylistColour, stylistInitials } from "./stylist-colours";

describe("stylistInitials", () => {
  it("takes the first letter of a single name and of the first and last of several", () => {
    expect(stylistInitials("Chris")).toBe("C");
    expect(stylistInitials("anna lee")).toBe("AL");
    expect(stylistInitials("Nguyễn Thị Lan")).toBe("NL");
    expect(stylistInitials("  Émile  ")).toBe("É");
    expect(stylistInitials("")).toBe("?");
  });
});

describe("stylistColour", () => {
  it("gives a team of up to eight a colour each, in team order", () => {
    const team = Array.from({ length: STYLIST_COLOURS.length }, (_, i) => stylistColour(i));
    expect(new Set(team).size).toBe(STYLIST_COLOURS.length);
    expect(stylistColour(STYLIST_COLOURS.length)).toBe(stylistColour(0));
  });
});
