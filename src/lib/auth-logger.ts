/**
 * Auth.js's logger (src/auth.ts). Its own logs every refused sign-in, a
 * mistyped password included, with console.error, which Sentry reports as an
 * error (sentry.server.config.ts captures console.error): every wrong
 * password in the salon became an alert, titled "None". A refused sign-in is
 * the login working, so it is a one-line warning here, which Sentry leaves
 * alone; anything else that goes wrong signing in is still an error.
 */

/** Whether `error` is Auth.js saying the email and password did not sign in (CredentialsSignin, or ours built on it). */
export function isRefusedSignIn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "CredentialsSignin"
  );
}

export const authLogger = {
  error(error: Error) {
    if (isRefusedSignIn(error)) {
      // No email here: the log is not where who tried to sign in is kept.
      const why = (error as { code?: string }).code === "too_many_attempts" ? "too many attempts" : "wrong email or password";
      console.warn(`[AUTH] Sign-in refused: ${why}`);
      return;
    }
    console.error("[AUTH]", error);
  },
};
