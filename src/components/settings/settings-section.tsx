/**
 * One section of a Settings tab: a card with a title, a line on what it is
 * for, room for a button or a status on the right, and the settings below.
 * Always open: with the page in tabs, each tab is short enough to show whole.
 */

import { cn } from "@/lib/utils";

export function SettingsSection({
  id,
  title,
  description,
  actions,
  attention = false,
  className,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A button or a status beside the title. */
  actions?: React.ReactNode;
  /** Something here still needs doing: an amber edge. */
  attention?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "scroll-mt-6 rounded-xl bg-card text-sm text-card-foreground shadow-surface ring-1",
        attention ? "ring-papaya-whip-400" : "ring-border",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0 max-w-2xl">
          <h2 id={headingId} className="font-heading text-base font-semibold leading-snug">
            {title}
          </h2>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children ? <div className="px-5 pb-5 pt-4">{children}</div> : <div className="pb-5" />}
    </section>
  );
}
