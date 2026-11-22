/**
 * Shown while a page's code arrives, so a tap in the menu answers at once
 * instead of the old page sitting there until the new one is ready.
 */
export default function Loading() {
  return (
    <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
