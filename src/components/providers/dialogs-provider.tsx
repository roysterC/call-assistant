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
 *   notify("Settings saved", "success");
 *
 * A notice is a snack bar (components/ui/snackbar): it sits at the bottom of
 * the screen for a few seconds and blocks nothing. Most notices say something
 * went wrong, so that is what one is unless told otherwise. A confirmation
 * waits for an answer, and closing it is "no".
 */

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SnackbarHost, snack, type SnackTone } from "@/components/ui/snackbar";
import { useT } from "@/components/providers/language-provider";
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
  notify: (message: string, tone?: SnackTone) => void;
}

const DialogsContext = createContext<Dialogs | null>(null);

export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const [asking, setAsking] = useState<ConfirmOptions | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const { t } = useT();

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

  const notify = useCallback((message: string, tone: SnackTone = "error") => snack(message, tone), []);

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
              {asking?.cancelLabel ?? t("common.cancel")}
            </Button>
            <Button variant={asking?.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
              {asking?.confirmLabel ?? t("common.ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SnackbarHost />
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useDialogs needs a DialogsProvider above it (the root layout has one)");
  return ctx;
}
