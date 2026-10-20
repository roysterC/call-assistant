import { describe, expect, it } from "vitest";
import { checkAnswers, checkEmail, checkPhone, discoveryCallUrl, systemSummary } from "./funnel";
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

describe("the discovery call", () => {
  it("takes only a Calendly page over https", () => {
    expect(discoveryCallUrl("https://calendly.com/kikai/30min")).toBe("https://calendly.com/kikai/30min");
    expect(discoveryCallUrl(" https://calendly.com/kikai/30min ")).toBe("https://calendly.com/kikai/30min");
    expect(discoveryCallUrl("http://calendly.com/kikai/30min")).toBeNull();
    expect(discoveryCallUrl("https://evil.example/calendly.com")).toBeNull();
    expect(discoveryCallUrl("https://notcalendly.com/x")).toBeNull();
    // The security policy frames calendly.com itself, nothing under it.
    expect(discoveryCallUrl("https://x.calendly.com/kikai")).toBeNull();
    expect(discoveryCallUrl("")).toBeNull();
    expect(discoveryCallUrl(undefined)).toBeNull();
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
