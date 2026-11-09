import { describe, expect, it } from "vitest";
import { bookedByMessage, bookedByMessageNote } from "./booked-by";

describe("which channel a booking came from", () => {
  it("is read back from the note the booking was given", () => {
    expect(bookedByMessage(`Long nails please. ${bookedByMessageNote("whatsapp")}`)).toBe("WhatsApp");
    expect(bookedByMessage(bookedByMessageNote("facebook"))).toBe("Messenger");
    expect(bookedByMessage("Booked by phone")).toBeNull();
    expect(bookedByMessage(null)).toBeNull();
  });
});
