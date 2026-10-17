import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
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

export default nextConfig;
