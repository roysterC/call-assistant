// Error reporting for the voice server, a separate process from the CRM.
// Called by index.ts once .env is loaded; does nothing until SENTRY_DSN is
// set. Reports crashes and anything logged with console.error.
import * as Sentry from "@sentry/node";
import { sentryOptions } from "@/lib/sentry-scrub";

export function initSentry() {
  Sentry.init({
    ...sentryOptions(process.env.SENTRY_DSN),
    serverName: "voice-server",
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}
