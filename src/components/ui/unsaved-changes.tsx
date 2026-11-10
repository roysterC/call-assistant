"use client";

/**
 * Unsaved changes on a page of settings: a save bar that comes up only once
 * something has been changed, and a check before the page is left.
 *
 * - SaveBar sits at the bottom of the page, in view however far down the
 *   person has scrolled, with Discard and Save. Hidden while nothing has
 *   changed, so it never asks for attention it does not need.
 * - useLeaveGuard asks "save, discard or stay?" when a link in the CRM is
 *   followed with changes unsaved, and lets the browser warn when the tab
 *   is closed or reloaded. The browser's own back button is not caught:
 *   intercepting it fights the router.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    // Sticky inside the page, so it lines up with the content rather than
    // spreading under the sidebar. On a phone the page already ends above
    // the tab bar (main-wrapper.tsx), so it sits just above that.
    <div
      className={cn(
        "sticky bottom-4 z-40 max-md:bottom-3",
        !dirty && "pointer-events-none"
      )}
      aria-hidden={!dirty}
    >
      <div
        role="region"
        aria-label="Unsaved changes"
        className={cn(
          // Clear of the assistant's round button, bottom right on a computer.
          "flex items-center gap-3 rounded-xl border bg-popover px-4 py-3 shadow-raised ring-1 ring-border transition-[opacity,translate] duration-200 ease-out md:mr-20",
          dirty ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        )}
      >
        <p className="flex-1 text-sm font-medium" aria-live="polite">
          {dirty ? "You have unsaved changes" : ""}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>
          Discard
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Asks before the page is left with changes unsaved. `save` reports whether
 * it worked: the page is left only if it did. Render the returned `dialog`;
 * a button that navigates in code (a back arrow) calls `leave(href)` instead
 * of router.push, so it asks too. Links are caught by themselves.
 */
export function useLeaveGuard({
  dirty,
  save,
  discard,
}: {
  dirty: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}) {
  const router = useRouter();
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Closing the tab or reloading: the browser's own warning (it shows its
  // own words; a page cannot set them).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // A link in the CRM: caught before the router sees it, so nothing is lost
  // until they have chosen.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeavingTo(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const go = useCallback(
    (href: string) => {
      setLeavingTo(null);
      router.push(href);
    },
    [router]
  );

  const dialog = (
    <Dialog open={leavingTo !== null} onOpenChange={(open) => !open && !busy && setLeavingTo(null)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription>You have changes on this page that are not saved yet.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setLeavingTo(null)}>
            Stay
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const to = leavingTo!;
              dirtyRef.current = false;
              discard();
              go(to);
            }}
          >
            Discard
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              const to = leavingTo!;
              setBusy(true);
              const ok = await save().finally(() => setBusy(false));
              if (ok) {
                dirtyRef.current = false;
                go(to);
              } else {
                setLeavingTo(null);
              }
            }}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save and leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /** Go to `href`, asking first if there are changes unsaved. */
  const leave = useCallback(
    (href: string) => {
      if (dirtyRef.current) setLeavingTo(href);
      else router.push(href);
    },
    [router]
  );

  return { dialog, leave };
}
