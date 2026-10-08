"use client";

/**
 * A Settings section that opens and closes: the title and a one-line summary
 * ("6 services") when closed, the editor when open.
 *
 * A native <details>, not a button, so it still opens inside the page's
 * disabled <fieldset>: a member can expand a section to read it even though
 * nothing in it can be changed.
 */

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function ExpandableSection({
  title,
  summary,
  description,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  /** Shown beside the title, open or closed: "6 services". */
  summary?: React.ReactNode;
  /** Under the title, open or closed. */
  description?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        "group overflow-hidden rounded-xl bg-card text-sm text-card-foreground shadow-surface ring-1 ring-border",
        className
      )}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-4 hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h2 className="font-heading text-[0.95rem] leading-snug font-semibold">{title}</h2>
          {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
        </div>
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-muted-foreground">
          {summary}
          <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t px-4 py-4">{children}</div>
    </details>
  );
}
