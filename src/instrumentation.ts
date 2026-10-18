/**
 * Runs once when the server starts (Next's instrumentation hook): turns on
 * error reporting, and passes Sentry every error a request throws.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
}

export const onRequestError = Sentry.captureRequestError;
