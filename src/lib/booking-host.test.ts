import { describe, expect, it } from "vitest";
import {
  bookingOrigin,
  isBookingHost,
  redirectToBookingHost,
  requestHostname,
  routeOnBookingHost,
  salonUrls,
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
