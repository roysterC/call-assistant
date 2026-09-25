import { Card, CardContent } from "@/components/ui/card";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  /** Optional: Insights shows four of these in a row and the icons add noise. */
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
  /**
   * Green value, for the one or two numbers on a page that are the point of it
   * — conversion rate, out-of-hours share. Distinct from `trend`, which tints
   * the subtitle to say which way something moved.
   */
  accent?: boolean;
}

/**
 * A single headline number.
 *
 * The label used to be `text-slate-500`, which measures 3.6:1 against the card
 * — under the 4.5:1 AA floor for text this size. On the first screen a client
 * sees, the words naming each number were the least readable thing on it. They
 * now use the muted token, at 6.1:1 on white.
 */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accent,
}: StatCardProps) {
  return (
    <Card className="gap-0 py-0 transition-shadow hover:shadow-raised">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13px] md:text-sm font-medium text-muted-foreground">{title}</p>
          {Icon && (
            <div className="w-8 h-8 md:w-9 md:h-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="w-[18px] h-[18px] text-primary" />
            </div>
          )}
        </div>
        {/* Tabular figures stop the numbers jittering sideways as they tick
            over, which is what made four cards in a row look unaligned. */}
        <p
          className={cn(
            "font-heading text-2xl md:text-[2rem] leading-none font-semibold mt-3 tabular-nums tracking-tight",
            accent ? "text-emerald-700" : "text-foreground"
          )}
        >
          {value}
        </p>
        {subtitle && (
          <p
            className={cn(
              "text-xs mt-2.5",
              trend === "up" && "text-emerald-700",
              trend === "down" && "text-red-600",
              (!trend || trend === "neutral") && "text-muted-foreground"
            )}
          >
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
