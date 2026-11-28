import { describe, expect, it } from "vitest";
import {
  bookingOrigin,
  hasOwnSubdomain,
  isBookingHost,
  redirectToBookingHost,
  requestHostname,
  routeOnBookingHost,
  routeOnSalonHost,
  salonDomain,
  salonFromHost,
  salonOrigin,
  salonUrls,
  servesOnlySalonPages,
} from "./booking-host";

const ORIGIN = "https://book.getkikai.com";

describe("bookingOrigin", () => {
  it("is the origin of BOOKING_URL, or null", () => {
    expect(bookingOrigin("https://book.getkikai.com/")).toBe(ORIGIN);
    expect(bookingOrigin("https://book.getkikai.com/anything")).toBe(ORIGIN);
    expect(bookingOrigin(undefined)).toBeNull();
    expect(bookingOrigin("")).toBeNull();
    expect(bookingOrigin("book.getkikai.com")).toBeNull();
    expect(bookingOrigin("ftp://book.getkikai.com")).toBeNull();
  });
});

describe("requestHostname", () => {
  it("prefers the host nginx forwarded, without port or case", () => {
    expect(requestHostname(new Headers({ "x-forwarded-host": "Book.GetKikai.com", host: "localhost:3000" }), "x")).toBe(
      "book.getkikai.com"
    );
    expect(requestHostname(new Headers({ host: "book.getkikai.com:443" }), "x")).toBe("book.getkikai.com");
    expect(requestHostname(new Headers(), "localhost:3000")).toBe("localhost");
  });

  it("is a booking host only when one is set up", () => {
    expect(isBookingHost("book.getkikai.com", ORIGIN)).toBe(true);
    expect(isBookingHost("app.getkikai.com", ORIGIN)).toBe(false);
    expect(isBookingHost("book.getkikai.com", null)).toBe(false);
  });
});

describe("routeOnBookingHost", () => {
  const route = (path: string, search = "") => routeOnBookingHost(path, search, ORIGIN);

  it("serves a salon's page and booking flow from /<slug>", () => {
    expect(route("/maison-hair")).toEqual({ kind: "rewrite", path: "/s/maison-hair" });
    expect(route("/maison-hair/")).toEqual({ kind: "rewrite", path: "/s/maison-hair" });
    expect(route("/maison-hair/book")).toEqual({ kind: "rewrite", path: "/s/maison-hair/book" });
    expect(route("/iconic-hair")).toEqual({ kind: "rewrite", path: "/s/iconic-hair" });
  });

  it("passes through what the pages need", () => {
    for (const p of [
      "/_next/static/chunks/x.js",
      "/api/book/maison-hair/availability",
      "/embed/book/maison-hair",
      "/book.js",
      // The salon's chat on its page.
      "/widget.js",
      "/embed",
      "/api/website-chat/message",
      "/api/monitoring",
      "/api/health",
      "/robots.txt",
      "/favicon.ico",
      "/apple-icon.png",
    ]) {
      expect(route(p)).toEqual({ kind: "pass" });
    }
  });

  it("never passes the CRM, its login or its API through", () => {
    for (const p of [
      "/login",
      "/settings",
      "/calendar",
      "/api/settings",
      "/api/auth/session",
      "/api/appointments",
      "/embedded",
      "/admin/organizations",
      "/maison-hair/book/extra",
      "/Maison-Hair",
    ]) {
      // Either nothing, or read as a salon's name: only ever /s/<slug>,
      // which shows a salon or "not found".
      const r = route(p);
      expect(r.kind === "not_found" || (r.kind === "rewrite" && /^\/s\/[a-z0-9-]+(\/book)?$/.test(r.path))).toBe(true);
    }
    expect(route("/api/settings")).toEqual({ kind: "not_found" });
    expect(route("/maison-hair/book/extra")).toEqual({ kind: "not_found" });
  });

  it("sends old /s/ links to the new address, keeping the query", () => {
    expect(route("/s/maison-hair/book", "?service=Blow%20dry")).toEqual({
      kind: "redirect",
      location: "https://book.getkikai.com/maison-hair/book?service=Blow%20dry",
    });
  });

  it("sends the bare address to the company's own site", () => {
    expect(route("/")).toEqual({ kind: "redirect", location: "https://getkikai.com/" });
  });
});

describe("on the app's own address", () => {
  it("moves salon pages to the booking address, and nothing else", () => {
    expect(redirectToBookingHost("/s/maison-hair", "", ORIGIN)).toBe("https://book.getkikai.com/maison-hair");
    expect(redirectToBookingHost("/s/maison-hair/book", "?start=x", ORIGIN)).toBe(
      "https://book.getkikai.com/maison-hair/book?start=x"
    );
    expect(redirectToBookingHost("/settings", "", ORIGIN)).toBeNull();
    expect(redirectToBookingHost("/embed/book/maison-hair", "", ORIGIN)).toBeNull();
  });
});

describe("salonUrls", () => {
  it("gives /<slug> on the booking address and /s/<slug> elsewhere", () => {
    expect(salonUrls("maison-hair", { origin: ORIGIN, onBookingHost: true })).toEqual({
      home: "/maison-hair",
      book: "/maison-hair/book",
      absoluteHome: "https://book.getkikai.com/maison-hair",
      absoluteBook: "https://book.getkikai.com/maison-hair/book",
    });
    expect(salonUrls("maison-hair", { origin: null, onBookingHost: false })).toEqual({
      home: "/s/maison-hair",
      book: "/s/maison-hair/book",
      absoluteHome: null,
      absoluteBook: null,
    });
  });
});

describe("salons' own addresses (SALON_DOMAIN)", () => {
  const DOMAIN = "getkikai.com";

  it("reads the domain, and nothing that isn't one", () => {
    expect(salonDomain("getkikai.com")).toBe(DOMAIN);
    expect(salonDomain(" .GetKikai.com. ")).toBe(DOMAIN);
    expect(salonDomain(undefined)).toBeNull();
    expect(salonDomain("")).toBeNull();
    expect(salonDomain("localhost")).toBeNull();
    expect(salonDomain("https://getkikai.com")).toBeNull();
  });

  it("finds the salon a hostname belongs to", () => {
    expect(salonFromHost("maison-nails.getkikai.com", DOMAIN)).toBe("maison-nails");
    expect(salonFromHost("maison-nails.getkikai.com", null)).toBeNull();
    // Our own addresses and the marketing site are never a salon.
    for (const h of ["app.getkikai.com", "book.getkikai.com", "www.getkikai.com", "getkikai.com"]) {
      expect(salonFromHost(h, DOMAIN)).toBeNull();
    }
    // Deeper names, other domains, and labels DNS would refuse.
    expect(salonFromHost("a.b.getkikai.com", DOMAIN)).toBeNull();
    expect(salonFromHost("maison.getkikai.com.evil.com", DOMAIN)).toBeNull();
    expect(salonFromHost("maison-.getkikai.com", DOMAIN)).toBeNull();
    expect(salonFromHost("-maison.getkikai.com", DOMAIN)).toBeNull();
  });

  it("gives a salon its own origin only when its slug can be one", () => {
    expect(salonOrigin("maison-nails", DOMAIN)).toBe("https://maison-nails.getkikai.com");
    expect(salonOrigin("maison-nails", null)).toBeNull();
    expect(salonOrigin("app", DOMAIN)).toBeNull();
    expect(hasOwnSubdomain("demo")).toBe(false);
    expect(hasOwnSubdomain("nails-by-mai")).toBe(true);
  });

  it("serves the page at / and booking at /book on the salon's address", () => {
    const route = (p: string, q = "") => routeOnSalonHost(p, q, "maison-nails", DOMAIN);
    expect(route("/")).toEqual({ kind: "rewrite", path: "/s/maison-nails" });
    expect(route("/book")).toEqual({ kind: "rewrite", path: "/s/maison-nails/book" });
    expect(route("/book/")).toEqual({ kind: "rewrite", path: "/s/maison-nails/book" });
    expect(route("/_next/static/chunks/x.js")).toEqual({ kind: "pass" });
    expect(route("/api/book/maison-nails/availability")).toEqual({ kind: "pass" });
    expect(route("/widget.js")).toEqual({ kind: "pass" });
    expect(route("/s/maison-nails/book", "?service=Gel")).toEqual({
      kind: "redirect",
      location: "https://maison-nails.getkikai.com/book?service=Gel",
    });
    // Nothing of the CRM, and no other salon's pages.
    for (const p of ["/login", "/settings", "/api/settings", "/s/other-salon", "/other-salon"]) {
      expect(route(p)).toEqual({ kind: "not_found" });
    }
  });

  it("leaves sending a salon on to its own address to its page, which knows it exists", () => {
    const route = (p: string, q = "") => routeOnBookingHost(p, q, ORIGIN);
    // A typo is "not found" on the booking address, not a redirect to a name with no certificate.
    expect(route("/maison-nails")).toEqual({ kind: "rewrite", path: "/s/maison-nails" });
    expect(route("/maison-nails/book")).toEqual({ kind: "rewrite", path: "/s/maison-nails/book" });
    expect(route("/s/maison-nails")).toEqual({ kind: "redirect", location: `${ORIGIN}/maison-nails` });
    // The booking script and embeds stay where salons' websites load them.
    expect(route("/book.js")).toEqual({ kind: "pass" });
    expect(route("/embed/book/maison-nails")).toEqual({ kind: "pass" });
  });

  it("serves only its own salon's booking API and embed", () => {
    const route = (p: string) => routeOnSalonHost(p, "", "maison-nails", DOMAIN);
    expect(route("/api/book/maison-nails/availability")).toEqual({ kind: "pass" });
    expect(route("/embed/book/maison-nails")).toEqual({ kind: "pass" });
    expect(route("/api/book/rival-salon/availability")).toEqual({ kind: "not_found" });
    expect(route("/embed/book/rival-salon")).toEqual({ kind: "not_found" });
  });

  it("never takes the app's own hostnames, or labels Let's Encrypt refuses, for a salon", () => {
    expect(salonFromHost("crm.getkikai.com", DOMAIN, ["crm.getkikai.com"])).toBeNull();
    expect(salonFromHost("maison-nails.getkikai.com", DOMAIN, ["crm.getkikai.com"])).toBe("maison-nails");
    expect(hasOwnSubdomain("ab--nails")).toBe(false);
    expect(hasOwnSubdomain("nails--ab")).toBe(true);
  });

  it("links within the salon's address from /, and gives the own address out", () => {
    expect(salonUrls("maison-nails", { origin: ORIGIN, domain: DOMAIN, onBookingHost: false, onSalonHost: true })).toEqual({
      home: "/",
      book: "/book",
      absoluteHome: "https://maison-nails.getkikai.com/",
      absoluteBook: "https://maison-nails.getkikai.com/book",
    });
    expect(salonUrls("demo", { origin: ORIGIN, domain: DOMAIN, onBookingHost: true })).toEqual({
      home: "/demo",
      book: "/demo/book",
      absoluteHome: `${ORIGIN}/demo`,
      absoluteBook: `${ORIGIN}/demo/book`,
    });
  });

  it("keeps the CRM's chrome off every address that only serves salons' pages", () => {
    const env = { BOOKING_URL: ORIGIN, SALON_DOMAIN: DOMAIN };
    expect(servesOnlySalonPages("book.getkikai.com", env)).toBe(true);
    expect(servesOnlySalonPages("maison-nails.getkikai.com", env)).toBe(true);
    expect(servesOnlySalonPages("app.getkikai.com", env)).toBe(false);
    expect(servesOnlySalonPages("maison-nails.getkikai.com", { BOOKING_URL: ORIGIN })).toBe(false);
    expect(servesOnlySalonPages("crm.getkikai.com", { ...env, AUTH_URL: "https://crm.getkikai.com" })).toBe(false);
  });
});
