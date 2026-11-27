/**
 * Widget attribution ("Powered by …"), on every salon's chat. The widget
 * renders inside an iframe, so a client cannot CSS-hide it from their own
 * page. (Removing it went with the old Pro plan.)
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
