"use client";

/**
 * The app's own "are you sure?" and "that didn't work", in place of the
 * browser's confirm() and alert(). Those stop the whole page, look like a
 * different program wrote them, and on a phone some browsers word them as a
 * warning from the website itself.
 *
 *   const { confirm, notify } = useDialogs();
 *   if (!(await confirm({ title: "Delete this site?", confirmLabel: "Delete", destructive: true }))) return;
 *   notify("Couldn't save. Try again.");
 *
 * A notice sits at the bottom of the screen for a few seconds and does not
 * block anything; a confirmation waits for an answer, and closing it is "no".
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for deleting or removing something. */
  destructive?: boolean;
}

interface Dialogs {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (message: string) => void;
}

const DialogsContext = createContext<Dialogs | null>(null);

const NOTICE_MS = 6000;

export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const [asking, setAsking] = useState<ConfirmOptions | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);

  const settle = useCallback((yes: boolean) => {
    answer.current?.(yes);
    answer.current = null;
    setAsking(null);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        setAsking(opts);
      }),
    []
  );

  const notify = useCallback((message: string) => setNotice({ id: Date.now(), message }), []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <DialogsContext.Provider value={{ confirm, notify }}>
      {children}

      <Dialog open={asking !== null} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{asking?.title}</DialogTitle>
            {asking?.body && <DialogDescription>{asking.body}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {asking?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={asking?.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
              {asking?.confirmLabel ?? "OK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        role="alert"
        aria-live="assertive"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {notice && (
          <div
            key={notice.id}
            className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-raised animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <span className="flex-1">{notice.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
              className="-mr-1 rounded p-0.5 opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useDialogs needs a DialogsProvider above it (the root layout has one)");
  return ctx;
}
