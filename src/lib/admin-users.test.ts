import { describe, expect, it } from "vitest";
import { canRemove, planUserChange } from "./admin-users";

describe("planUserChange", () => {
  it("moves a login between owner and staff", () => {
    expect(planUserChange({ role: "member" }, { role: "admin" })).toEqual({ ok: true, role: "admin" });
    expect(planUserChange({ role: "admin" }, { role: "member" })).toEqual({ ok: true, role: "member" });
  });

  it("sets a new password of at least 8 characters", () => {
    expect(planUserChange({ role: "member" }, { password: "longenough" })).toEqual({ ok: true, password: "longenough" });
    expect(planUserChange({ role: "member" }, { password: "short" })).toMatchObject({ ok: false, status: 400 });
    expect(planUserChange({ role: "member" }, { password: 12345678 })).toMatchObject({ ok: false, status: 400 });
  });

  it("never makes a super-admin, or a role that does not exist", () => {
    expect(planUserChange({ role: "member" }, { role: "superAdmin" })).toMatchObject({ ok: false, status: 400 });
    expect(planUserChange({ role: "member" }, { role: "stylist" })).toMatchObject({ ok: false, status: 400 });
  });

  it("leaves a super-admin login alone", () => {
    expect(planUserChange({ role: "superAdmin" }, { password: "longenough" })).toMatchObject({ ok: false, status: 403 });
    expect(planUserChange({ role: "superAdmin" }, { role: "member" })).toMatchObject({ ok: false, status: 403 });
  });

  it("can bring a withdrawn stylist login back as staff", () => {
    expect(planUserChange({ role: "stylist" }, { role: "member" })).toEqual({ ok: true, role: "member" });
  });

  it("refuses an empty change", () => {
    expect(planUserChange({ role: "member" }, {})).toMatchObject({ ok: false, status: 400 });
  });
});

describe("canRemove", () => {
  it("removes owners, staff and withdrawn logins, never a super-admin", () => {
    expect(canRemove({ role: "admin" })).toBe(true);
    expect(canRemove({ role: "member" })).toBe(true);
    expect(canRemove({ role: "stylist" })).toBe(true);
    expect(canRemove({ role: "superAdmin" })).toBe(false);
  });
});
