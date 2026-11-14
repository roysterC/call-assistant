import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialsSignin } from "@auth/core/errors";
import { authLogger, isRefusedSignIn } from "./auth-logger";

class TooManyAttempts extends CredentialsSignin {
  code = "too_many_attempts";
}

describe("the sign-in logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a wrong password as a warning, not an error (so not a Sentry alert)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    authLogger.error(new CredentialsSignin());
    expect(warn).toHaveBeenCalledWith("[AUTH] Sign-in refused: wrong email or password");
    expect(error).not.toHaveBeenCalled();
  });

  it("says when it was the attempts limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    authLogger.error(new TooManyAttempts());
    expect(warn).toHaveBeenCalledWith("[AUTH] Sign-in refused: too many attempts");
  });

  it("still reports anything else as an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new Error("database unreachable");
    authLogger.error(broken);
    expect(error).toHaveBeenCalledWith("[AUTH]", broken);
    expect(isRefusedSignIn(broken)).toBe(false);
  });
});
