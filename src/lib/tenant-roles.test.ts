import { describe, expect, it } from "vitest";
import { isTenantRole } from "./tenant-roles";

describe("isTenantRole", () => {
  it("accepts the three roles", () => {
    expect(isTenantRole("member")).toBe(true);
    expect(isTenantRole("admin")).toBe(true);
    expect(isTenantRole("superAdmin")).toBe(true);
  });

  it("refuses a withdrawn stylist login, or anything else", () => {
    expect(isTenantRole("stylist")).toBe(false);
    expect(isTenantRole("")).toBe(false);
    expect(isTenantRole(undefined)).toBe(false);
  });
});
