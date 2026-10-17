import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { withSentryConfig } from "@sentry/nextjs/config";
import { securityHeaders } from "./src/lib/security-headers";

// The voice server's address comes from .env, which must be read before the
// headers are worked out.
loadEnvConfig(process.cwd());

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js" advertising what to attack.
  poweredByHeader: false,
  async headers() {
    return securityHeaders({
      voiceUrl: process.env.RECEPTIONIST_VOICE_URL,
      dev: process.env.NODE_ENV !== "production",
    });
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Readable stack traces need the build's source maps in Sentry, which
  // needs SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT at build time.
  // Without them the build goes ahead and traces show built code.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
