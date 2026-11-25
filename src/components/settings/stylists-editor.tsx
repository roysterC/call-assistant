"use client";

import { useT } from "@/components/providers/language-provider";
import type { BusinessType } from "@/lib/business-types";
import type { MessageKey } from "@/lib/i18n";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stylist, SalonService } from "@/lib/salon-config";
import { openWeekdays, type DayHours } from "@/lib/business-hours";
import { ServicePicker } from "@/components/settings/service-picker";
import { apiFetch } from "@/lib/api-fetch";

/**
 * The team, and what makes each of them bookable.
 *
 * A stylist without a Google calendar id is listed but cannot be booked — the
 * agent knows the name and will say it, but has no diary to check. That state
 * is legitimate during setup, so it is shown plainly rather than treated as an
 * error.
 */

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The "Signs in as" choice that goes to inviting someone, not a login. */
const INVITE = "__invite__";

/**
 * Whether she is booked into: off for someone on the team who is not (a
 * receptionist), who then has no column in the diary and is never offered.
 */
function TakesBookings({ id, on, onFlip }: { id: string; on: boolean; onFlip: (on: boolean) => void }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2">
      <div className="min-w-0 flex-1">
        <p id={id} className="text-sm font-semibold">
          {t("sty.takesBookings")}
        </p>
        <p className="text-xs text-muted-foreground">{on ? t("sty.takesBookingsOn") : t("sty.takesBookingsOff")}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        onClick={() => onFlip(!on)}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          on ? "bg-primary" : "bg-tea-green-700"
        )}
      >
        <span
          aria-hidden="true"
          className={cn("absolute top-[3px] left-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform", on && "translate-x-5")}
        />
      </button>
    </div>
  );
}

export function StylistsEditor({
  value,
  services,
  businessHours,
  usesGoogle = false,
  trade,
  logins,
  onInvite,
  onChange,
}: {
  value: Stylist[];
  services: SalonService[];
  businessHours: DayHours[];
  /**
   * The salon's diary is Google Calendar, so each stylist needs a calendar to
   * be bookable. On the salon's own diary (the default) nobody does, and the
   * field is not shown.
   */
  usesGoogle?: boolean;
  /** The salon's main type, for the role example; defaults to the signed-in salon's. */
  trade?: BusinessType;
  /**
   * The salon's logins, for "Signs in as" (the owner, in Settings). Not
   * given, the choice is not shown.
   */
  logins?: Array<{ id: string; label: string }> | null;
  /** Where "Invite her to sign in" goes: the logins card. */
  onInvite?: () => void;
  onChange: (next: Stylist[]) => void;
}) {
  const { t } = useT();
  const kind: BusinessType = trade ?? "nails";
  // Nobody works a day the salon is shut. With hours unconfigured every day
  // stays selectable — the alternative is an editor that silently refuses
  // every button before opening hours have been filled in.
  const openDays = openWeekdays(businessHours);
  const constrained = openDays.length > 0;
  const isOpen = (day: number) => !constrained || openDays.includes(day);

  // Removing someone with bookings still to come asks first. The bookings are
  // not deleted: they stay in the diary under the name, in a column of their
  // own, and come back under the stylist if the same name is added again.
  const [confirmRemove, setConfirmRemove] = useState<{ index: number; upcoming: number } | null>(null);
  const [checking, setChecking] = useState<number | null>(null);

  function remove(index: number) {
    onChange(value.filter((_, j) => j !== index));
    setConfirmRemove(null);
  }

  async function askToRemove(index: number) {
    const name = value[index].name.trim();
    const id = value[index].id;
    if (!name && !id) return remove(index);
    setChecking(index);
    try {
      // By her id when she has one: her bookings even under a name changed here but not saved yet.
      const who = id ? `technician=${encodeURIComponent(id)}` : `stylist=${encodeURIComponent(name)}`;
      const res = await apiFetch(`/api/appointments?status=booked&scope=upcoming&${who}`);
      const upcoming = res.ok ? ((await res.json()).appointments ?? []).length : 0;
      if (upcoming === 0) remove(index);
      else setConfirmRemove({ index, upcoming });
    } catch {
      // Could not check: ask anyway rather than remove without warning.
      setConfirmRemove({ index, upcoming: -1 });
    } finally {
      setChecking(null);
    }
  }

  function update(index: number, patch: Partial<Stylist>) {
    const next = [...value];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function toggleDay(index: number, day: number) {
    if (!isOpen(day)) return;
    const current = value[index].workingDays ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort();
    update(index, { workingDays: next });
  }

  return (
    <div className="space-y-4">
      {value.length === 0 && <p className="text-sm text-muted-foreground">{t("sty.empty")}</p>}

      {value.map((stylist, i) => {
        const bookable = !usesGoogle || Boolean(stylist.googleCalendarId);
        return (
          <div key={i} className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={stylist.name}
                placeholder={t("sty.name")}
                onChange={(e) => update(i, { name: e.target.value })}
                className="h-8 w-40"
                aria-label={t("sty.nameLabel")}
              />
              <Input
                value={stylist.role ?? ""}
                placeholder={t("sty.role", { example: t(`sty.roleExample.${kind}` as MessageKey) })}
                onChange={(e) => update(i, { role: e.target.value })}
                className="h-8 flex-1 min-w-[12rem]"
                aria-label={t("sty.roleLabel")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void askToRemove(i)}
                disabled={checking === i}
                aria-label={t("sty.remove", { name: stylist.name || t("sty.stylist") })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {confirmRemove?.index === i && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded-md border border-papaya-whip-400 bg-papaya-whip-700 px-3 py-2 text-sm text-papaya-whip-100"
              >
                <CircleAlert className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  {confirmRemove.upcoming === 1
                    ? t("sty.upcomingOne", { name: stylist.name })
                    : confirmRemove.upcoming > 1
                      ? t("sty.upcomingMany", { name: stylist.name, n: confirmRemove.upcoming >= 200 ? "200+" : confirmRemove.upcoming })
                      : t("sty.cantCheck", { name: stylist.name })}{" "}
                  {t("sty.stay", { name: stylist.name })}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => remove(i)}>
                  {t("sty.removeAnyway")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                  {t("sty.keep")}
                </Button>
              </div>
            )}

            <TakesBookings
              id={`takes-bookings-${i}`}
              on={stylist.takesBookings !== false}
              onFlip={(on) => {
                const { takesBookings: _old, ...rest } = stylist;
                void _old;
                const next = [...value];
                next[i] = on ? rest : { ...rest, takesBookings: false };
                onChange(next);
              }}
            />

            {logins && (
              <div>
                <label htmlFor={`signs-in-${i}`} className="block text-xs text-muted-foreground">
                  {t("sty.signsIn")}
                </label>
                <select
                  id={`signs-in-${i}`}
                  value={stylist.userId ?? ""}
                  onChange={(e) => {
                    if (e.target.value === INVITE) {
                      onInvite?.();
                      return;
                    }
                    update(i, { userId: e.target.value || null });
                  }}
                  className="mt-1 h-9 w-full max-w-sm rounded-lg border border-input bg-card px-2.5 text-base md:text-sm"
                >
                  <option value="">{t("sty.noLogin")}</option>
                  {logins.map((l) => {
                    const elsewhere = value.some((o, j) => j !== i && o.userId === l.id);
                    return (
                      <option key={l.id} value={l.id} disabled={elsewhere}>
                        {elsewhere ? t("sty.loginTaken", { login: l.label }) : l.label}
                      </option>
                    );
                  })}
                  {onInvite && <option value={INVITE}>{t("sty.invite")}</option>}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">{stylist.userId ? t("sty.loginHelp") : t("sty.noLoginHelp")}</p>
              </div>
            )}

            {stylist.takesBookings !== false && usesGoogle && (
              <div>
                <label className="text-xs text-muted-foreground">{t("sty.calendar")}</label>
                <Input
                  value={stylist.googleCalendarId ?? ""}
                  placeholder="…@group.calendar.google.com"
                  onChange={(e) =>
                    update(i, { googleCalendarId: e.target.value.trim() })
                  }
                  className="h-8 mt-1 font-mono text-xs"
                  aria-label={t("sty.calendar")}
                />
                {!bookable && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-papaya-whip-100">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    {t("sty.notBookable")}
                  </p>
                )}
              </div>
            )}

            {stylist.takesBookings !== false && (<>
            <div>
              <label className="text-xs text-muted-foreground">{t("sty.days")}</label>
              <div className="mt-1 flex flex-wrap gap-1">
                {DAY_ORDER.map((day) => {
                  const open = isOpen(day);
                  const on = open && (stylist.workingDays ?? []).includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={!open}
                      onClick={() => toggleDay(i, day)}
                      aria-pressed={on}
                      title={open ? undefined : t("sty.closedDay")}
                      className={cn(
                        "px-2 py-0.5 rounded-md text-xs font-medium transition-colors",
                        !open
                          ? "text-muted-foreground/40 line-through cursor-not-allowed"
                          : on
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )}
                    >
                      {t(`dayShort.${day}` as MessageKey)}
                    </button>
                  );
                })}
              </div>
              {(stylist.workingDays ?? []).filter(isOpen).length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{t("sty.anyDay")}</p>
              )}
            </div>

            {services.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">{t("sty.services")}</span>
                <ServicePicker
                  stylistName={stylist.name}
                  services={services}
                  value={stylist.services ?? []}
                  onChange={(next) => update(i, { services: next })}
                />
              </div>
            )}
            </>)}
          </div>
        );
      })}

      {constrained && (
        <p className="text-xs text-muted-foreground">{t("sty.struck")}</p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...value,
            { name: "", role: "", googleCalendarId: "", workingDays: [], services: [] },
          ])
        }
      >
        <Plus className="h-4 w-4 mr-1" />
        {t("sty.add")}
      </Button>
    </div>
  );
}
