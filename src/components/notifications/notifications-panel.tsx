"use client";

/**
 * The bell: everything waiting on this person (src/lib/notifications.ts) in
 * one panel, with its count. New bookings, callbacks waiting and quotes
 * waiting for a price, each opening where it is dealt with; a switch for the
 * chime on this device. NotificationsRuntime keeps the count in the browser
 * tab's title and on the app's icon.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarPlus, Images, PhoneCall } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { pushState, type PushState } from "@/lib/push-client";
import { notificationsChanged, useNotifications, useNotificationSound } from "@/lib/use-notifications";
import { noticesChanged } from "@/lib/use-booking-notices";
import { ago, when } from "@/components/notifications/booking-alerts";
import { useT } from "@/components/providers/language-provider";
import type { NotificationItem, NotificationKind } from "@/lib/notifications";

/** "99+" past 99. */
export function countText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * The bell, as a row of the menu (`rail`: folded to its icon) or a button in
 * a phone's header. Opens the panel.
 */
export function NotificationsBell({ variant, collapsed = false }: { variant: "menu" | "header"; collapsed?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const { total } = useNotifications(true);
  const label = t("notif.title");
  const aria = total ? t("nav.waiting", { label, n: total }) : label;

  return (
    <>
      {variant === "menu" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={collapsed ? label : undefined}
          aria-label={aria}
          className="group relative flex h-[52px] w-full items-center gap-3 rounded-[14px] px-[17px] text-[15px] font-semibold whitespace-nowrap text-cornsilk-500 transition-colors hover:bg-white/8"
        >
          <span className="relative shrink-0">
            <Bell className="h-[22px] w-[22px] text-tea-green-600" strokeWidth={2} />
            {total > 0 && collapsed && (
              <span aria-hidden className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-light-bronze-500 ring-2 ring-sidebar" />
            )}
          </span>
          <span className={collapsed ? "hidden" : ""}>{label}</span>
          {total > 0 && !collapsed && (
            <span
              aria-hidden
              className="ml-auto h-5 min-w-5 rounded-full bg-light-bronze-500 px-1.5 text-center text-[11px] leading-5 font-bold text-light-bronze-100 tabular-nums"
            >
              {countText(total)}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={aria}
          className="relative flex h-10 w-10 items-center justify-center rounded-full text-cornsilk-500 transition-colors hover:bg-white/8"
        >
          <Bell className="h-5 w-5" strokeWidth={1.75} />
          {total > 0 && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0 h-[18px] min-w-[18px] rounded-full bg-light-bronze-500 px-1 text-center text-[10px] leading-[18px] font-bold text-light-bronze-100 tabular-nums ring-2 ring-sidebar"
            >
              {countText(total)}
            </span>
          )}
        </button>
      )}
      <NotificationsPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

const SECTIONS: Array<{ kind: NotificationKind; titleKey: "notif.bookings" | "notif.callbacks" | "notif.quotes"; page: string }> = [
  { kind: "booking", titleKey: "notif.bookings", page: "/calendar" },
  { kind: "callback", titleKey: "notif.callbacks", page: "/callbacks" },
  { kind: "quote", titleKey: "notif.quotes", page: "/conversations" },
];

function NotificationsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT();
  const n = useNotifications(true);
  const [sound, setSound] = useNotificationSound();
  const [alerts, setAlerts] = useState<PushState | null>(null);
  const pathname = usePathname();

  // Whether this device gets them when the CRM is closed: said once it is known.
  useEffect(() => {
    if (!open) return;
    let live = true;
    pushState()
      .then((s) => live && setAlerts(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  // Going somewhere from the panel closes it.
  useEffect(() => {
    onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a change of page
  }, [pathname]);

  async function markBookingsSeen() {
    await apiFetch("/api/booking-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    }).catch(() => {});
    noticesChanged();
    notificationsChanged();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 bg-background sm:max-w-md">
        <div className="border-b border-border px-5 pt-5 pb-4">
          <SheetTitle className="font-heading text-xl font-bold">
            {t("notif.title")}
            {n.total > 0 && <span className="ml-2 text-base font-semibold text-muted-foreground tabular-nums">{n.total}</span>}
          </SheetTitle>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {n.loaded && n.total === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Bell className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="text-sm text-muted-foreground">{t("notif.allClear")}</p>
            </div>
          )}

          {SECTIONS.map(({ kind, titleKey, page }) => {
            const count = n.counts[kind];
            if (count === 0) return null;
            const items = n.items.filter((i) => i.kind === kind);
            const more = count - items.length;
            return (
              <section key={kind} aria-labelledby={`notif-${kind}`} className="mb-6 last:mb-0">
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 id={`notif-${kind}`} className="flex-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
                    {t(titleKey)} · {count}
                  </h3>
                  {kind === "booking" && (
                    <button type="button" onClick={() => void markBookingsSeen()} className="text-[12.5px] font-semibold text-primary hover:underline">
                      {t("notif.markSeen")}
                    </button>
                  )}
                  {kind === "callback" && (
                    <Link href={withAsOrg(page)} className="text-[12.5px] font-semibold text-primary hover:underline">
                      {t("notif.allCallbacks")}
                    </Link>
                  )}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {items.map((item) => (
                    <li key={item.key}>
                      <Row item={item} timeZone={n.timeZone} />
                    </li>
                  ))}
                </ul>
                {more > 0 && (
                  <Link href={withAsOrg(page)} className="mt-1.5 block px-3 text-[12.5px] font-semibold text-primary hover:underline">
                    {t("notif.more", { n: more })}
                  </Link>
                )}
              </section>
            );
          })}
        </div>

        <div className="space-y-3 border-t border-border px-5 py-4">
          <label className="flex cursor-pointer items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t("notif.sound")}</span>
              <span className="block text-xs text-muted-foreground">{t("notif.soundHint")}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={sound}
              onChange={(e) => setSound(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-6 w-11 shrink-0 rounded-full bg-muted-foreground/30 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5"
            />
          </label>
          {alerts && alerts !== "on" && alerts !== "unsupported" && (
            <p className="text-xs text-muted-foreground">
              {t("notif.alertsHint")}{" "}
              <Link href={withAsOrg("/settings/account")} className="font-semibold text-primary hover:underline">
                {t("notif.account")}
              </Link>
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const ICONS: Record<NotificationKind, { icon: typeof Bell; tone: string }> = {
  booking: { icon: CalendarPlus, tone: "bg-[#fbe7f1] text-[#b02a6b]" },
  callback: { icon: PhoneCall, tone: "bg-papaya-whip-900 text-light-bronze-200" },
  quote: { icon: Images, tone: "bg-tea-green-900 text-tea-green-200" },
};

function Row({ item, timeZone }: { item: NotificationItem; timeZone: string }) {
  const { t, lang, clock } = useT();
  const { icon: Icon, tone } = ICONS[item.kind];
  const detail =
    item.kind === "booking" && item.startsAt
      ? `${item.detail} · ${t("alerts.withStylist", { when: when(item.startsAt, timeZone, lang, clock), stylist: item.stylist ?? "" })}`
      : item.kind === "quote"
        ? item.designs === 1
          ? t("notif.design", { channel: item.detail })
          : t("notif.designs", { n: item.designs ?? 0, channel: item.detail })
        : item.detail;
  return (
    <Link
      href={withAsOrg(item.href)}
      className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", tone)} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ago(item.at, t)}</span>
        </span>
        {detail && <span className="block truncate text-[13px] text-muted-foreground">{detail}</span>}
        {item.notBooked && (
          <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">
            {t("notif.notBooked")}
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * The count where people see it without the CRM in front of them: "(3)" at
 * the start of the browser tab's title, and on the app's icon when it is
 * installed. Kept on through page changes, which set their own titles.
 */
export function NotificationsRuntime() {
  const { total } = useNotifications(true);
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\) /, "");
      const want = total > 0 ? `(${countText(total)}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (total > 0) void nav.setAppBadge?.(total).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
    return () => watch.disconnect();
  }, [total]);
  return null;
}
