import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What a panel shows when it has nothing to show.
 *
 * A bordered box containing one greyed line — or worse, nothing at all — reads
 * as a failed render rather than an empty one, and the dashboard had exactly
 * that: a titled card with a bare "No call data yet" floating in it. Saying
 * what would appear here, and why it hasn't yet, is the difference between "not
 * working" and "nothing yet".
 *
 * `hint` is the important half. "No leads captured yet" leaves someone
 * wondering whether it is broken; adding what causes a lead to appear turns it
 * into an instruction.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-12",
        className
      )}
    >
      {Icon && (
        <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && (
        <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
          {hint}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
