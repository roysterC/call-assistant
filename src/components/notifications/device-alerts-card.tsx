"use client";

/**
 * Account → "Booking alerts on this device": push notifications for the
 * receptionist's bookings, turned on per phone or computer.
 */

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { pushState, turnPushOff, turnPushOn, type PushState } from "@/lib/push-client";
import { useT } from "@/components/providers/language-provider";
import type { MessageKey } from "@/lib/i18n";

const SAYS: Record<PushState, MessageKey> = {
  unsupported: "push.unsupported",
  "needs-home-screen": "push.needsHomeScreen",
  blocked: "push.blocked",
  off: "push.off",
  on: "push.on",
};

export function DeviceAlertsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { t } = useT();

  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);

  async function on() {
    setBusy(true);
    setNote(null);
    try {
      const r = await turnPushOn();
      if (!r.ok) setNote({ ok: false, text: t(r.message) });
      setState(await pushState());
    } catch {
      setNote({ ok: false, text: t("push.couldNotTurnOn") });
    } finally {
      setBusy(false);
    }
  }

  async function off() {
    setBusy(true);
    setNote(null);
    try {
      await turnPushOff();
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const res = await apiFetch("/api/push/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setNote(
        res.ok && data.sent > 0
          ? { ok: true, text: t("push.testSent") }
          : { ok: false, text: data.error ?? t("push.testFailed") }
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BellRing className="w-5 h-5" />
          {t("push.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{state ? t(SAYS[state]) : t("push.checking")}</p>
        <div className="flex flex-wrap gap-2">
          {state === "off" && (
            <Button onClick={on} disabled={busy}>
              {t("push.turnOn")}
            </Button>
          )}
          {state === "on" && (
            <>
              <Button variant="outline" onClick={test} disabled={busy}>
                {t("push.sendTest")}
              </Button>
              <Button variant="ghost" onClick={off} disabled={busy}>
                {t("push.turnOff")}
              </Button>
            </>
          )}
        </div>
        {note && <p className={`text-xs ${note.ok ? "text-tea-green-200" : "text-rose-600"}`}>{note.text}</p>}
      </CardContent>
    </Card>
  );
}
