import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { phoneSearch } from "./drafts";

describe("phoneSearch", () => {
  it("finds a whole number however it was written, by its last nine digits", () => {
    expect(phoneSearch("07700 900123")).toEqual({ endsWith: "700900123" });
    expect(phoneSearch("+44 7700 900123")).toEqual({ endsWith: "700900123" });
    expect(phoneSearch("who's on 07700-900-123?")).toEqual({ endsWith: "700900123" });
  });

  it("finds a number by its ending", () => {
    expect(phoneSearch("ending 123")).toEqual({ endsWith: "123" });
    expect(phoneSearch("number ending in 0123")).toEqual({ endsWith: "0123" });
  });

  it("is not a number search for a name, or too few digits to mean anything", () => {
    expect(phoneSearch("Sarah Jones")).toBeNull();
    expect(phoneSearch("Sarah 2")).toBeNull();
  });
});
