import { describe, expect, it, vi } from "vitest";
import { checkAnswers, checkEmail, checkPhone, consultationBooking, isGoogleShortLink, systemSummary } from "./funnel";
import { consultationBookingFromEnv, followGoogleShortLink } from "./consultation-link";
import { calendlyEmbedUrl } from "@/components/funnel/lead-funnel";

const good = {
  hasSystem: true,
  system: "Fresha",
  businessName: "  Shogo   Hair ",
  ownerName: "Jo Bloggs",
  phone: "07700 900123",
  email: "Jo@Shogo.co.uk ",
};

describe("checkAnswers", () => {
  it("tidies what was typed: spaces, the number's form, the email's case", () => {
    const r = checkAnswers(good);
    expect(r).toEqual({
      ok: true,
      value: {
        hasSystem: true,
        system: "Fresha",
        businessName: "Shogo Hair",
        ownerName: "Jo Bloggs",
        phone: "+447700900123",
        email: "jo@shogo.co.uk",
      },
    });
  });

  it("names the first answer that is missing, so the page can go back to it", () => {
    expect(checkAnswers({ ...good, hasSystem: undefined })).toMatchObject({ ok: false, field: "hasSystem" });
    expect(checkAnswers({ ...good, businessName: " " })).toMatchObject({ ok: false, field: "businessName" });
    expect(checkAnswers({ ...good, ownerName: "" })).toMatchObject({ ok: false, field: "ownerName" });
    expect(checkAnswers({ ...good, phone: "12" })).toMatchObject({ ok: false, field: "phone" });
    expect(checkAnswers({ ...good, email: "jo@" })).toMatchObject({ ok: false, field: "email" });
  });

  it("drops the system when they have none, and lets them skip naming it", () => {
    expect(checkAnswers({ ...good, hasSystem: false })).toMatchObject({ ok: true, value: { system: null } });
    expect(checkAnswers({ ...good, system: "" })).toMatchObject({ ok: true, value: { system: null } });
  });
});

describe("checkPhone and checkEmail", () => {
  it("take a UK number however it is written", () => {
    expect(checkPhone("+44 7700 900123")).toEqual({ ok: true, value: "+447700900123" });
    expect(checkPhone("020 7946 0123")).toEqual({ ok: true, value: "+442079460123" });
    expect(checkPhone("")).toMatchObject({ ok: false });
    // One digit short of a mobile.
    expect(checkPhone("07700 90012")).toEqual({ ok: false, message: "A mobile number has 11 digits." });
  });

  it("refuse an email that cannot be one", () => {
    expect(checkEmail("jo@shogo")).toMatchObject({ ok: false });
    expect(checkEmail("jo shogo@x.co")).toMatchObject({ ok: false });
  });
});

describe("systemSummary", () => {
  it("reads as the line the Leads page shows", () => {
    expect(systemSummary({ hasSystem: false })).toBe("No booking system yet");
    expect(systemSummary({ hasSystem: true, system: "Phorest" })).toBe("Already uses Phorest");
    expect(systemSummary({ hasSystem: true, system: null })).toBe("Already uses a booking system");
  });
});

describe("the free consultation's booking page", () => {
  it("takes a Calendly page over https, and nothing like one", () => {
    expect(consultationBooking("https://calendly.com/kikai/30min")).toEqual({
      kind: "calendly",
      url: "https://calendly.com/kikai/30min",
    });
    expect(consultationBooking(" https://calendly.com/kikai/30min ")?.url).toBe("https://calendly.com/kikai/30min");
    expect(consultationBooking("http://calendly.com/kikai/30min")).toBeNull();
    expect(consultationBooking("https://evil.example/calendly.com")).toBeNull();
    expect(consultationBooking("https://notcalendly.com/x")).toBeNull();
    // The security policy frames calendly.com itself, nothing under it.
    expect(consultationBooking("https://x.calendly.com/kikai")).toBeNull();
    expect(consultationBooking("")).toBeNull();
    expect(consultationBooking(undefined)).toBeNull();
  });

  it("takes a Google Calendar booking page, in Google's embeddable form", () => {
    const embed = "https://calendar.google.com/calendar/appointments/schedules/AcZssZ1abc_DEF-2?gv=true";
    expect(consultationBooking("https://calendar.google.com/calendar/appointments/schedules/AcZssZ1abc_DEF-2")).toEqual({
      kind: "google",
      url: embed,
    });
    expect(
      consultationBooking("https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ1abc_DEF-2?pli=1")?.url
    ).toBe(embed);
    // Some other Google Calendar page is not a booking page.
    expect(consultationBooking("https://calendar.google.com/calendar/u/0/r")).toBeNull();
    expect(consultationBooking("https://calendar.google.evil.com/calendar/appointments/schedules/x")).toBeNull();
  });

  it("knows a Google short link when it sees one", () => {
    expect(isGoogleShortLink("https://calendar.app.google/AbC123")).toBe(true);
    expect(isGoogleShortLink("https://calendly.com/kikai")).toBe(false);
    // Short links cannot be framed, so they are never taken as they are.
    expect(consultationBooking("https://calendar.app.google/AbC123")).toBeNull();
  });

  it("opens Calendly with their name and email already filled in", () => {
    const url = new URL(
      calendlyEmbedUrl("https://calendly.com/kikai/30min", { name: " Jo Bloggs ", email: "jo@shogo.co.uk" }, "crm.example")
    );
    expect(url.origin + url.pathname).toBe("https://calendly.com/kikai/30min");
    expect(url.searchParams.get("name")).toBe("Jo Bloggs");
    expect(url.searchParams.get("email")).toBe("jo@shogo.co.uk");
    expect(url.searchParams.get("embed_domain")).toBe("crm.example");
    expect(url.searchParams.get("hide_gdpr_banner")).toBe("1");
  });
});

describe("following a Google short link", () => {
  const page = "https://calendar.google.com/calendar/appointments/schedules/AcZssZ9xyz";
  const reply = (url: string, body = "") => (async () => ({ url, text: async () => body })) as unknown as typeof fetch;

  it("lands on the booking page a redirect leads to", async () => {
    expect(await followGoogleShortLink("https://calendar.app.google/a", reply(page))).toEqual({
      kind: "google",
      url: `${page}?gv=true`,
    });
  });

  it("reads the booking page from the link's own page when there is no redirect", async () => {
    const html = `<html><a href="${page}?pli=1">Open</a></html>`;
    expect((await followGoogleShortLink("https://calendar.app.google/a", reply("https://calendar.app.google/a", html)))?.url).toBe(
      `${page}?gv=true`
    );
  });

  it("gives up quietly when the link leads nowhere useful", async () => {
    expect(await followGoogleShortLink("https://calendar.app.google/a", reply("https://calendar.app.google/a", "Not found"))).toBeNull();
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await followGoogleShortLink("https://calendar.app.google/a", failing)).toBeNull();
  });

  it("reads CONSULTATION_URL, and DISCOVERY_CALL_URL, its first name, when that is all there is", async () => {
    vi.stubEnv("CONSULTATION_URL", "");
    vi.stubEnv("DISCOVERY_CALL_URL", "https://calendly.com/kikai/old");
    expect((await consultationBookingFromEnv())?.url).toBe("https://calendly.com/kikai/old");
    vi.stubEnv("CONSULTATION_URL", "https://calendly.com/kikai/new");
    expect((await consultationBookingFromEnv())?.url).toBe("https://calendly.com/kikai/new");
    vi.stubEnv("CONSULTATION_URL", "");
    vi.stubEnv("DISCOVERY_CALL_URL", "");
    expect(await consultationBookingFromEnv()).toBeNull();
    vi.unstubAllEnvs();
  });
});
