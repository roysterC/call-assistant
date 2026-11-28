"use client";

/**
 * A link into the booking flow that shows it's working while the next step
 * loads. The public pages deliberately have no loading.tsx (it would turn a
 * switched-off salon's 404 into a 200: components/route-loading), so without
 * this a tap on "Book" on a slow phone looks like nothing happened.
 */

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import type { ComponentProps } from "react";

/**
 * While the next page loads: the tapped link itself takes a pulsing tint of
 * its own text colour, so it's plain which one was tapped, and a bar in the
 * salon's colour runs across the top of the screen.
 *
 * The bar goes on the page's root ([data-salon-root], where --brand is set)
 * rather than inside the link: a link that is pressed in or lifted on hover
 * is transformed, and a transformed parent pins a fixed bar to itself instead
 * of to the screen. Only ever rendered after a tap, so `document` is there.
 */
function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  const host = document.querySelector("[data-salon-root]") ?? document.body;
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-current opacity-15 motion-safe:animate-pulse"
      />
      {createPortal(
        <span
          role="progressbar"
          aria-label="Loading"
          className="fixed inset-x-0 top-0 z-50 h-1 animate-pulse"
          style={{ background: "var(--brand)" }}
        />,
        host
      )}
    </>
  );
}

export function BookLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={`relative ${className ?? ""}`}>
      {children}
      <Pending />
    </Link>
  );
}
