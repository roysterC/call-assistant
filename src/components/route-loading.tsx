/**
 * Shown while a page's code arrives, so a tap in the menu answers at once
 * instead of the old page sitting there until the new one is ready.
 *
 * Each signed-in section's loading.tsx shows this; there is deliberately no
 * app-wide one. A loading boundary makes Next send "200 OK" before the page
 * has run, so a public page's notFound() (a salon's booking page switched
 * off, a used invite link) could only ever be a 200 marked noindex, never a
 * real 404.
 */
export default function Loading() {
  return (
    <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
