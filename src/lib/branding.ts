/**
 * Widget attribution ("Powered by …") and the plan rules for removing it.
 *
 * Two things make this enforceable rather than decorative. The widget renders
 * inside an iframe, so a client cannot CSS-hide the attribution from their own
 * page. And whether to show it is decided server-side on every config fetch,
 * from the organisation's billing state — never from a flag the client can set
 * on their own record.
 */

/**
 * Vendor identity, read from the environment rather than hardcoded: the
 * business's own domain has changed once already, and a wrong link on every
 * client's site is a worse failure than a missing one.
 */
export function brandingIdentity() {
  return {
    label: process.env.BRANDING_LABEL || "Kikai",
    url: process.env.BRANDING_URL || "",
  };
}

/**
 * Whether the widget should render attribution: always, unless the site asks
 * to hide it and Kikai has switched on premium chat for the salon in Admin
 * (Organization.premiumChat). Re-evaluated per request rather than trusted
 * from the stored flag, so switching it off brings the line back at once.
 */
export function shouldShowBranding(premiumChat: boolean | null | undefined, hideBranding: boolean | null | undefined): boolean {
  if (!hideBranding) return true;
  return !premiumChat;
}
