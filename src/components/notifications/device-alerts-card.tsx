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

const SAYS: Record<PushState, string> = {
  unsupported: "This browser cannot show alerts. The pop-ups in the CRM still appear whenever it is open.",
  "needs-home-screen":
    "On an iPhone or iPad, alerts come to the diary app on your home screen. In Safari, tap Share, then Add to Home Screen, open the diary from there and turn alerts on.",
  blocked: "Alerts are blocked for this site. Allow notifications for it in the browser's settings, then come back here.",
  off: "Get a notification on this device when the receptionist books someone in, even with the CRM closed.",
  on: "On. This device gets a notification when the receptionist books someone in.",
};

export function DeviceAlertsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);

  async function on() {
    setBusy(true);
    setNote(null);
    try {
      const r = await turnPushOn();
      if (!r.ok) setNote({ ok: false, text: r.message });
      setState(await pushState());
    } catch {
      setNote({ ok: false, text: "Could not turn alerts on. Try again." });
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
          ? { ok: true, text: "Sent. It should arrive in a few seconds." }
          : { ok: false, text: data.error ?? "It did not go. Turn alerts off and on again." }
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
          Booking alerts on this device
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{state ? SAYS[state] : "Checking this device…"}</p>
        <div className="flex flex-wrap gap-2">
          {state === "off" && (
            <Button onClick={on} disabled={busy}>
              Turn alerts on
            </Button>
          )}
          {state === "on" && (
            <>
              <Button variant="outline" onClick={test} disabled={busy}>
                Send a test
              </Button>
              <Button variant="ghost" onClick={off} disabled={busy}>
                Turn off
              </Button>
            </>
          )}
        </div>
        {note && <p className={`text-xs ${note.ok ? "text-tea-green-200" : "text-rose-600"}`}>{note.text}</p>}
      </CardContent>
    </Card>
  );
}
