"use client";

/**
 * A line across the top of every page when the plan needs the owner
 * (src/lib/plan.ts): the free trial's last days with no card, a failed
 * payment, or a plan paused. Staff see it too, without the button: they
 * cannot open Plan and billing, but should know why booking is refused.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useT } from "@/components/providers/language-provider";
import type { PlanState } from "@/lib/plan";
import { cn } from "@/lib/utils";

export function PlanBanner() {
  const { t } = useT();
  const pathname = usePathname();
  const { data: session } = useSession();
  const [plan, setPlan] = useState<Pick<PlanState, "warning" | "trialDaysLeft"> | null>(null);

  // Again on each page: a card added, or a payment made, clears it.
  useEffect(() => {
    let live = true;
    apiFetch("/api/billing/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setPlan(d?.plan ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  const w = plan?.warning;
  if (!plan || !w || w === "trialNoCard") return null;
  const owner = session?.user?.role !== "member";
  const text =
    w === "restricted" ? t("plan.banner.paused") : w === "paymentFailed" ? t("plan.banner.failed") : t("plan.banner.trial", { days: plan.trialDaysLeft ?? 0 });

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm md:px-8",
        w === "restricted" ? "bg-destructive/10 text-foreground" : "bg-papaya-whip-700 text-papaya-whip-100"
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      {owner && !pathname?.startsWith("/settings") && (
        <Link href="/settings#plan" className="font-semibold underline underline-offset-2">
          {t("plan.banner.action")}
        </Link>
      )}
    </div>
  );
}
