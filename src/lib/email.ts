/**
 * Email from the app: invitations, password resets and address confirmations,
 * sent through Resend (resend.com). Nothing else is sent by email.
 *
 * Set on the server, in .env beside the app:
 *
 *   RESEND_API_KEY  the key from Resend → API Keys
 *   EMAIL_FROM      who it is from, on a domain verified in Resend:
 *                   "Kikai <no-reply@example.co.uk>"
 *   EMAIL_REPLY_TO  optional: where a reply goes, if not nowhere
 *
 * Without a key, a development build writes each email to the server log
 * instead, so the links can be followed locally; a production build reports
 * that email is not set up, and callers fall back to what they did before.
 */

const RESEND_URL = "https://api.resend.com/emails";

export interface Email {
  to: string;
  subject: string;
  /** Plain text, for clients that show no HTML and for the spam filters. */
  text: string;
  html: string;
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Whether email goes anywhere: really sent, or (in development) logged. */
export function emailAvailable(): boolean {
  return emailConfigured() || process.env.NODE_ENV !== "production";
}

export async function sendEmail(email: Email, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[EMAIL] (not sent: no RESEND_API_KEY) to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.text}`);
      return { ok: true, id: null };
    }
    return { ok: false, error: "Email is not set up on this server." };
  }
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      // Resend says why: an unverified domain, a bad key, a rate limit.
      console.error(`[EMAIL] Resend refused (${res.status}): ${body.message ?? "no reason given"}`);
      return { ok: false, error: "The email could not be sent." };
    }
    return { ok: true, id: body.id ?? null };
  } catch (error) {
    console.error("[EMAIL] send failed:", error);
    return { ok: false, error: "The email could not be sent." };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * One message with one button: everything this app sends. Plain, light and
 * on brand, readable with images off, and the link written out too for a
 * client that strips buttons.
 */
export function actionEmail(input: {
  to: string;
  subject: string;
  heading: string;
  /** Paragraphs before the button. */
  lines: string[];
  button: string;
  url: string;
  /** A last line in small print: how long the link lasts, what to do if it was not you. */
  footer: string;
}): Email {
  const p = (s: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#2a2e22">${escapeHtml(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4ef">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4ef;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td>
<p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#5b6635">Kikai</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#2a2e22">${escapeHtml(input.heading)}</h1>
${input.lines.map(p).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#5b6635;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${escapeHtml(input.button)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7066">Or copy this into your browser:<br><span style="word-break:break-all">${escapeHtml(input.url)}</span></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7066">${escapeHtml(input.footer)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  const text = [input.heading, "", ...input.lines.flatMap((l) => [l, ""]), `${input.button}: ${input.url}`, "", input.footer].join("\n");
  return { to: input.to, subject: input.subject, text, html };
}
