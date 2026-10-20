/**
 * The security headers every response carries (next.config.ts).
 *
 * The CRM may not be shown inside anyone else's page (clickjacking). The
 * chat widget's page, /embed, is the exception: showing it inside salons'
 * websites is its job, so it may be framed anywhere and is denied the
 * microphone.
 *
 * The content security policy keeps scripts, connections and forms to this
 * site, plus the voice server's websocket and the error reporter. Next's
 * pages carry inline scripts and the charts inline styles, so those are
 * allowed: the policy cannot stop an injected inline script, but it stops a
 * page sending data anywhere else, loading plugins or being framed.
 */

export interface HeaderOptions {
  /** wss://… of the voice server (RECEPTIONIST_VOICE_URL), if it is elsewhere. */
  voiceUrl?: string;
  /** Extra connect-src origins, e.g. the error reporter's ingest host. */
  connectOrigins?: string[];
  dev?: boolean;
}

type Header = { key: string; value: string };

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^(wss?|https?):$/.test(u.protocol)) return null;
    return `${u.protocol.replace("http", "ws")}//${u.host}`;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(frameAncestors: string, o: HeaderOptions = {}): string {
  const connect = ["'self'", originOf(o.voiceUrl), ...(o.connectOrigins ?? [])].filter(Boolean);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(o.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Instagram and Messenger profile pictures, and chat widget logos.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [...new Set(connect as string[])],
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    // The website editor previews the widget, which is this site's own page;
    // the in-person funnel (/meet) shows Calendly to book a discovery call.
    "frame-src": ["'self'", "https://calendly.com"],
    "frame-ancestors": [frameAncestors],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

const COMMON: Header[] = [
  // A year. Not preloaded: the host is still a nip.io name.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

export function securityHeaders(o: HeaderOptions = {}): { source: string; headers: Header[] }[] {
  return [
    {
      // Everything but the widget's page.
      source: "/:path((?!embed(?:/|$)).*)",
      headers: [
        ...COMMON,
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: contentSecurityPolicy("'none'", o) },
        // The assistant listens; nothing else needs a device.
        { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
      ],
    },
    {
      source: "/embed/:path*",
      headers: [
        ...COMMON,
        { key: "Content-Security-Policy", value: contentSecurityPolicy("*", o) },
        { key: "Permissions-Policy", value: "microphone=(), camera=(), geolocation=(), payment=(), usb=()" },
      ],
    },
  ];
}
