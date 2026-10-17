interface LeadMarkerData {
  name?: string;
  email?: string;
  phone?: string;
  summary?: string;
}

/**
 * Extract the [LEAD:{json}] marker from the AI response (if present)
 * and return the cleaned text without the marker.
 *
 * The AI is instructed to emit this marker at the end of a message
 * once it has captured the visitor's details.
 */
export function parseLeadMarker(text: string): {
  cleanText: string;
  lead: LeadMarkerData | null;
} {
  const match = text.match(/\[LEAD:(\{[^\]]+\})\]/);
  if (!match) return { cleanText: text, lead: null };

  try {
    const lead = JSON.parse(match[1]) as LeadMarkerData;
    const cleanText = text.replace(match[0], "").trim();
    return { cleanText, lead };
  } catch (err) {
    console.error("[WEBSITE CHAT] Failed to parse LEAD marker:", err);
    return { cleanText: text, lead: null };
  }
}

/**
 * Check whether an origin is in the allowed list.
 * Supports wildcards like "*.example.com" and the catch-all "*".
 */
export function checkCORS(
  origin: string | null,
  allowedOrigins: string[]
): boolean {
  if (!origin) return false;
  if (allowedOrigins.length === 0) return true; // no restriction
  if (allowedOrigins.includes("*")) return true;

  for (const pattern of allowedOrigins) {
    if (pattern === origin) return true;
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      if (origin.endsWith(suffix)) return true;
    }
  }
  return false;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * The widget makes its session id with crypto.randomUUID(). Anything else —
 * a megabyte of text, an object — is not our widget, and is refused before
 * it becomes a rate-limit key or a database row.
 */
export function isValidSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(sessionId);
}

/**
 * How many bot replies one website may get through the model in a day.
 * Above it, visitors' messages still reach the inbox; only the model is
 * skipped. The site id is public in its embed code, so without a ceiling a
 * script could spend without limit. Generous for a salon: 300 replies is
 * around fifty conversations. WEBSITE_CHAT_DAILY_REPLY_CAP overrides it.
 */
export const DEFAULT_DAILY_REPLY_CAP = 300;

export function dailyReplyCap(raw = process.env.WEBSITE_CHAT_DAILY_REPLY_CAP): number {
  const n = Number(raw);
  return raw?.trim() && Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_REPLY_CAP;
}

/** The reply a visitor gets once the day's cap is spent. */
export const OVER_CAP_REPLY =
  "Thanks for your message. We're a little busy right now, so one of the team will reply here as soon as they can.";

/**
 * Whether a widget CTA destination is safe for the host page to navigate to.
 *
 * This one is load-bearing. The value is stored config that widget.js assigns
 * to `location` inside the *client's* page, so a "javascript:" URL saved here
 * is stored XSS on their site, executing with their origin — and the widget is
 * the thing that would fire it. widget.js re-checks the protocol for the same
 * reason; neither check is redundant, because either layer alone can be
 * bypassed by a row written before it existed.
 *
 * Relative paths and fragments ("/contact", "#book") are allowed and common —
 * the widget resolves them against the host page. Anything carrying an
 * explicit scheme must be http or https: that rejects javascript:, data:,
 * vbscript: and file: while leaving ordinary links alone.
 */
export function isSafeCTAUrl(url: string): boolean {
  // Browsers ignore control characters and whitespace when resolving a scheme,
  // so "java\nscript:alert(1)" navigates. Strip them before testing or the
  // check reads a scheme that the browser will not.
  const cleaned = url.replace(/[\u0000-\u0020]/g, "");
  if (!cleaned) return false;

  const scheme = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return true; // relative path or fragment

  const protocol = scheme[1].toLowerCase();
  return protocol === "http" || protocol === "https";
}
