import { describe, expect, it } from "vitest";
import { confirmationBody, reminderBody, rescheduleBody } from "./sms";
import { describeAppointmentWhen } from "./business-hours";

const TZ = "Europe/London";
const base = {
  clientName: "Sarah",
  serviceName: "Cut and finish",
  stylistName: "Jo",
  whenText: "Thursday at 2pm",
  businessName: "Shogo",
  contactPhone: "01234 567890",
};

describe("message bodies", () => {
  it("confirms with the salon's number, since the sender is one-way", () => {
    const body = confirmationBody(base);
    expect(body).toContain("Sarah");
    expect(body).toContain("Thursday at 2pm");
    expect(body).toContain("Jo");
    expect(body).toContain("01234 567890");
    expect(body).toContain("Shogo");
  });

  it("reads as a reminder, not a fresh booking", () => {
    expect(reminderBody(base)).toContain("reminder");
    expect(confirmationBody(base)).not.toContain("reminder");
  });

  it("copes with no name on file", () => {
    const body = confirmationBody({ ...base, clientName: null });
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
    expect(body.startsWith("you're booked")).toBe(true);
  });

  it("omits the call-us line rather than printing a blank number", () => {
    const body = confirmationBody({ ...base, contactPhone: null });
    expect(body).not.toContain("Call us");
    expect(body).toContain("Shogo");
  });

  it("stays inside a single SMS segment for a typical booking", () => {
    // 160 GSM-7 characters. Longer messages are billed and delivered as
    // several parts, which looks broken on some handsets.
    expect(confirmationBody(base).length).toBeLessThanOrEqual(160);
    expect(reminderBody(base).length).toBeLessThanOrEqual(160);
    expect(confirmationBody({ ...base, bookingNumber: 1043 }).length).toBeLessThanOrEqual(160);
  });

  it("gives the booking number, which is enough to change the booking by phone", () => {
    expect(confirmationBody({ ...base, bookingNumber: 1043 })).toContain("Booking no. 1043.");
    expect(reminderBody({ ...base, bookingNumber: 1043 })).toContain("Booking no. 1043.");
    expect(
      rescheduleBody({ ...base, bookingNumber: 1043, previousWhenText: "Wednesday at 2pm" })
    ).toContain("Booking no. 1043.");
    // Older bookings have none: no blank "Booking no. null".
    expect(confirmationBody({ ...base, bookingNumber: null })).not.toContain("Booking no.");
  });
});

describe("describeAppointmentWhen", () => {
  const now = new Date("2026-09-14T09:00:00Z"); // Monday

  const at = (iso: string) => new Date(iso);

  it("uses relative wording where it is unambiguous", () => {
    expect(describeAppointmentWhen(at("2026-09-14T13:00:00Z"), TZ, now)).toBe("today at 2pm");
    expect(describeAppointmentWhen(at("2026-09-15T13:00:00Z"), TZ, now)).toBe("tomorrow at 2pm");
  });

  it("names the day within the week", () => {
    expect(describeAppointmentWhen(at("2026-09-17T13:00:00Z"), TZ, now)).toBe("Thursday at 2pm");
  });

  it("adds the date further out", () => {
    expect(describeAppointmentWhen(at("2026-10-01T13:00:00Z"), TZ, now)).toBe(
      "Thursday 1 October at 2pm"
    );
  });

  it("includes minutes only when there are any", () => {
    expect(describeAppointmentWhen(at("2026-09-17T13:15:00Z"), TZ, now)).toBe("Thursday at 2:15pm");
  });

  it("renders in salon time, not UTC", () => {
    // 16:45Z in BST is quarter to six in the evening.
    expect(describeAppointmentWhen(at("2026-09-17T16:45:00Z"), TZ, now)).toBe("Thursday at 5:45pm");
  });
});

describe("service names in message bodies", () => {
  const base = {
    clientName: "Sarah",
    stylistName: "Shogo",
    whenText: "Thursday at 2pm",
    businessName: "Shogo",
    contactPhone: "0333 038 8801",
  };

  it("drops the article for plural services", () => {
    const b = confirmationBody({ ...base, serviceName: "Full head highlights" });
    expect(b).toContain("for full head highlights");
    expect(b).not.toContain("a full head highlights");
  });

  it("uses 'an' before a vowel", () => {
    const b = confirmationBody({ ...base, serviceName: "Olaplex treatment" });
    expect(b).toContain("an olaplex treatment");
  });

  it("uses 'a' otherwise", () => {
    expect(confirmationBody({ ...base, serviceName: "Cut and finish" })).toContain(
      "a cut and finish"
    );
  });

  it("keeps the article for a singular name ending in double s", () => {
    expect(confirmationBody({ ...base, serviceName: "Hair press" })).toContain(
      "a hair press"
    );
  });

  it("still fits one segment with the longest realistic combination", () => {
    // Longest service, a long name, and the stylist name repeated as sign-off.
    const b = reminderBody({
      ...base,
      clientName: "Christopher",
      serviceName: "Full head highlights",
    });
    expect(b.length).toBeLessThanOrEqual(160);
  });
});
