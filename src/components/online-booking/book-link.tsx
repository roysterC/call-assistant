"use client";

/**
 * A link into the booking flow that shows it's working while the next step
 * loads. The public pages deliberately have no loading.tsx (it would turn a
 * switched-off salon's 404 into a 200: components/route-loading), so without
 * this a tap on "Book" on a slow phone looks like nothing happened.
 */

import Link from "next/link";
import { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

/**
 * A bar across the top of the screen in the salon's colour. Above the sticky
 * header (z-10) as long as nothing between it and the page makes a stacking
 * context of its own: so the link doesn't fade (opacity would trap it), and
 * the phone's fixed bottom bar sits above the header too.
 */
function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="progressbar"
      aria-label="Loading"
      className="fixed inset-x-0 top-0 z-50 h-1 animate-pulse"
      style={{ background: "var(--brand)" }}
    />
  );
}

export function BookLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <Pending />
    </Link>
  );
}
