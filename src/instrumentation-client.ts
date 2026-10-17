/**
 * Error reporting in the browser. Does nothing until NEXT_PUBLIC_SENTRY_DSN
 * is set at build time. Reports go through this site's own /api/monitoring,
 * so the content security policy and ad blockers let them through.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-scrub";

Sentry.init({ ...sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN), tunnel: "/api/monitoring" });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
