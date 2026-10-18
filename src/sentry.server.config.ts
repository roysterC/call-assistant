// Error reporting for the CRM's server side (pages and API routes). Loaded by
// instrumentation.ts; does nothing until SENTRY_DSN is set. Most routes
// catch their errors and log them with console.error rather than throw, so
// those lines are reported too.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-scrub";

Sentry.init({
  ...sentryOptions(process.env.SENTRY_DSN),
  integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
});
