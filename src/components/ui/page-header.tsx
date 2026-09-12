import { cn } from "@/lib/utils";

/**
 * The title block at the top of every page.
 *
 * It exists because the pages had drifted: different heading sizes and weights,
 * two different muted colours for the description, and one page bolting its
 * buttons on in a row of its own. Individually invisible, collectively the
 * thing that makes an app feel assembled rather than designed.
 *
 * `actions` keeps page-level buttons on the header's baseline instead of each
 * page inventing its own row for them.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 flex-wrap",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
