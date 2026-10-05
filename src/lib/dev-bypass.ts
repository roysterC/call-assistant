/**
 * The local-dev login bypass (DEV_BYPASS_AUTH=1 in .env.local): no session
 * needed, everyone is the seeded super-admin.
 *
 * Never in a production build, whatever the environment says. The variables
 * were once copied onto the production box along with the rest of
 * .env.local.example, which left the whole CRM open to anyone as super-admin
 * and turned every signed-in user into the mock super-admin on refresh. An
 * environment variable alone must not be able to do that again.
 *
 * `next build` and `next start` run with NODE_ENV=production; `next dev`
 * with development. Both are inlined at build time, so in a production build
 * the bypass branches are dead code.
 */

/** Server side: middleware, requireTenant, requireSuperAdmin. */
export function devBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_BYPASS_AUTH === "1";
}

/** Browser side: the mock session. Needs its own NEXT_PUBLIC_ variable. */
export function clientDevBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}
