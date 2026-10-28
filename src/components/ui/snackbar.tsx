"use client";

/**
 * The snack bar: a short note at the bottom of the screen that something
 * saved, or did not, which goes by itself after a few seconds.
 *
 *   snack("Settings saved", "success");
 *   snack("Couldn't save. Try again.", "error");
 *
 * Animate UI's toast over Base UI's: it rises in, its tick draws itself (an
 * error's icon shakes instead), a thin bar along the bottom runs down the
 * time left, and it can be swiped away. Several stack, the newest in front;
 * hovering spreads them out and pauses them. Reduced motion is respected
 * through the MotionProvider in the root layout.
 *
 * Dressed like the sidebar, dark sage with cream text, so it reads as the
 * app speaking rather than a browser notice.
 */

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Toast } from "@animate-ui/react/primitives/base-ui/toast";
import { useT } from "@/components/providers/language-provider";
import { cn } from "@/lib/utils";

export type SnackTone = "success" | "error" | "info";

/** One manager for the whole app, so a snack can be raised from anywhere. */
const snackbars = Toast.createToastManager();

/** Long enough to read twice; an error longer, since it asks something of you. */
const TIMEOUT_MS: Record<SnackTone, number> = { success: 4000, info: 5000, error: 8000 };

export function snack(title: string, tone: SnackTone = "info", description?: string): void {
  snackbars.add({ title, description, type: tone, timeout: TIMEOUT_MS[tone] });
}

const ICON: Record<SnackTone, { Icon: typeof CircleCheck; className: string }> = {
  success: { Icon: CircleCheck, className: "text-tea-green-400" },
  error: { Icon: CircleAlert, className: "text-red-300" },
  info: { Icon: Info, className: "text-light-bronze-500" },
};

function toneOf(type: string | undefined): SnackTone {
  return type === "success" || type === "error" ? type : "info";
}

function Snacks() {
  const { toasts } = Toast.useToastManager();
  const { t } = useT();
  return toasts.map((toast) => {
    const { Icon, className } = ICON[toneOf(toast.type)];
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        swipeDirection={["down", "right"]}
        data-testid="snackbar"
        className={cn(
          "absolute inset-x-0 bottom-0 select-none overflow-hidden rounded-2xl",
          "bg-sidebar text-sidebar-accent-foreground shadow-raised ring-1 ring-sidebar-border",
          // Those behind take the front one's height, so the stack is tidy;
          // spread out, each is its own height.
          "[height:var(--toast-frontmost-height,var(--toast-height))] data-[expanded]:[height:var(--toast-height)]",
          "[z-index:calc(100-var(--toast-index))]",
          // Bridges the gap between spread-out snacks, so moving the pointer
          // down the stack does not collapse it.
          "after:absolute after:inset-x-0 after:top-full after:h-[calc(0.75rem+1px)]"
        )}
      >
        <Toast.Content className="flex items-start gap-3 px-4 py-3 data-[behind]:opacity-0 data-[expanded]:opacity-100">
          <span data-slot="toast-icon" className={cn("mt-px shrink-0", className)}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <Toast.Title className="text-sm font-semibold leading-5" />
            {toast.description && (
              <Toast.Description className="mt-0.5 text-[13px] leading-5 text-sidebar-foreground/80" />
            )}
          </div>
          <Toast.Close
            aria-label={t("common.dismiss")}
            className="-mr-1 rounded-md p-1 text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <X className="h-4 w-4" />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

/** Where snacks appear: bottom centre, above the assistant's button on a phone. */
export function SnackbarHost() {
  return (
    <Toast.Provider toastManager={snackbars} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-24 left-1/2 z-[60] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 md:bottom-6">
          <Snacks />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
