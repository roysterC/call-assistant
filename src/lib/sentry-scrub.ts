/**
 * What an error report may carry to Sentry. The CRM holds salons' clients:
 * names, numbers, emails, what they booked. An error is reported with its
 * message and stack, which page or route, and the salon and login ids;
 * never cookies, request bodies, or anything that reads as a phone number
 * or an email address.
 */

import type { ErrorEvent } from "@sentry/node";

// Nine or more digits, however spaced: a UK number has ten or eleven, a date eight.
const PHONE = /\+?\d(?:[\s()-]{0,2}\d){8,}/g;
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;

export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[number]");
}

const withoutQuery = (url: string) => url.split("?")[0];

/** Every string inside, scrubbed; URLs (and navigation's from/to) lose their query. */
function scrubDeep(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return /^(url|from|to)$/.test(key) ? scrubText(withoutQuery(value)) : scrubText(value);
  }
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, k)]));
  }
  return value;
}

export function scrubEvent<T extends ErrorEvent>(event: T): T {
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) {
        if (/^(cookie|authorization|x-hub-signature|x-twilio-signature|x-vapi)/i.test(h)) delete event.request.headers[h];
      }
    }
    // Query strings carry session ids and, on the diary, client searches.
    if (event.request.query_string) event.request.query_string = "[removed]";
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data) crumb.data = scrubDeep(crumb.data) as typeof crumb.data;
  }
  if (event.extra) event.extra = scrubDeep(event.extra) as typeof event.extra;
  return event;
}

/** Shared by the browser, the server and the voice server. */
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NODE_ENV,
    // Errors only by default: performance tracing costs quota and is opt-in.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0) || 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  };
}
