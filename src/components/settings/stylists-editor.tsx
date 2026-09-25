"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stylist, SalonService } from "@/lib/salon-config";
import { openWeekdays, type DayHours } from "@/lib/business-hours";

/**
 * The team, and what makes each of them bookable.
 *
 * A stylist without a Google calendar id is listed but cannot be booked — the
 * agent knows the name and will say it, but has no diary to check. That state
 * is legitimate during setup, so it is shown plainly rather than treated as an
 * error.
 */

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export function StylistsEditor({
  value,
  services,
  businessHours,
  usesGoogle = false,
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
  onChange: (next: Stylist[]) => void;
}) {
  // Nobody works a day the salon is shut. With hours unconfigured every day
  // stays selectable — the alternative is an editor that silently refuses
  // every button before opening hours have been filled in.
  const openDays = openWeekdays(businessHours);
  const constrained = openDays.length > 0;
  const isOpen = (day: number) => !constrained || openDays.includes(day);

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

  function toggleService(index: number, name: string) {
    const current = value[index].services ?? [];
    const next = current.includes(name)
      ? current.filter((s) => s !== name)
      : [...current, name];
    update(index, { services: next });
  }

  return (
    <div className="space-y-4">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No one added yet.
        </p>
      )}

      {value.map((stylist, i) => {
        const bookable = !usesGoogle || Boolean(stylist.googleCalendarId);
        return (
          <div key={i} className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={stylist.name}
                placeholder="Name"
                onChange={(e) => update(i, { name: e.target.value })}
                className="h-8 w-40"
                aria-label="Stylist name"
              />
              <Input
                value={stylist.role ?? ""}
                placeholder="Role, e.g. colour specialist"
                onChange={(e) => update(i, { role: e.target.value })}
                className="h-8 flex-1 min-w-[12rem]"
                aria-label="Role"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={`Remove ${stylist.name || "stylist"}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {usesGoogle && (
              <div>
                <label className="text-xs text-muted-foreground">
                  Google calendar ID
                </label>
                <Input
                  value={stylist.googleCalendarId ?? ""}
                  placeholder="…@group.calendar.google.com"
                  onChange={(e) =>
                    update(i, { googleCalendarId: e.target.value.trim() })
                  }
                  className="h-8 mt-1 font-mono text-xs"
                  aria-label="Google calendar ID"
                />
                {!bookable && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-700">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    Not bookable until a calendar is shared with the service
                    account.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground">
                Working days
              </label>
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
                      title={open ? undefined : "The salon is closed this day"}
                      className={cn(
                        "px-2 py-0.5 rounded-md text-xs font-medium transition-colors",
                        !open
                          ? "text-muted-foreground/40 line-through cursor-not-allowed"
                          : on
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )}
                    >
                      {DAY_SHORT[day]}
                    </button>
                  );
                })}
              </div>
              {(stylist.workingDays ?? []).filter(isOpen).length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  None selected — treated as available any day the salon is open.
                </p>
              )}
            </div>

            {services.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground">
                  Services they do
                </label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {services.map((s) => {
                    const on = (stylist.services ?? []).includes(s.name);
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => toggleService(i, s.name)}
                        aria-pressed={on}
                        className={cn(
                          "px-2 py-0.5 rounded-md text-xs transition-colors",
                          on
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        )}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
                {(stylist.services ?? []).length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    None selected — treated as doing everything.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {constrained && (
        <p className="text-xs text-muted-foreground">
          Struck-through days are ones the salon is closed. Change them under
          Opening hours.
        </p>
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
        Add stylist
      </Button>
    </div>
  );
}
