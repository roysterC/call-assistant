"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, PATCH_TEST_BADGE } from "@/lib/status-styles";
import type { SalonService } from "@/lib/salon-config";
import { minorToInput, parseMoney } from "@/lib/money";
import { REBOOK_WEEKS_MAX, REBOOK_WEEKS_MIN } from "@/lib/salon-config";

/**
 * Services and how long each takes.
 *
 * Duration is the load-bearing field. It decides how much of a stylist's day
 * gets blocked, so a three-hour balayage entered as thirty minutes will be
 * offered into gaps it cannot possibly fit — and the salon finds out when the
 * client is already in the chair.
 *
 * The patch-test flag carries real liability: it forces a 48-hour lead time
 * for anyone the salon has not seen before.
 */
export function ServicesEditor({
  value,
  onChange,
  rebook = false,
}: {
  value: SalonService[];
  onChange: (next: SalonService[]) => void;
  /** Show when each is due again, for rebooking texts (src/lib/rebook.ts). */
  rebook?: boolean;
}) {
  function update(index: number, patch: Partial<SalonService>) {
    const next = [...value];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function add() {
    onChange([
      ...value,
      {
        name: "",
        durationMinutes: 45,
        requiresPatchTest: false,
        priceMinor: null,
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No services yet. Without at least one, the receptionist cannot check
          the diary — it has no way to know how long an appointment needs.
        </p>
      )}

      {value.map((service, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-2 rounded-md border p-2"
        >
          <Input
            value={service.name}
            placeholder="Service name"
            onChange={(e) => update(i, { name: e.target.value })}
            className="h-8 flex-1 min-w-[10rem]"
            aria-label="Service name"
          />

          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={5}
              step={5}
              value={service.durationMinutes}
              onChange={(e) =>
                update(i, { durationMinutes: Number(e.target.value) })
              }
              className="h-8 w-20"
              aria-label="Duration in minutes"
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">£</span>
            <Input
              // Keyed by the price, so one filled in from a price list
              // (services-import.tsx) shows instead of the old one.
              key={`${i}-${service.priceMinor}`}
              inputMode="decimal"
              placeholder="—"
              defaultValue={minorToInput(service.priceMinor)}
              onBlur={(e) =>
                update(i, { priceMinor: parseMoney(e.target.value) })
              }
              className="h-8 w-20"
              aria-label="Price in pounds"
            />
          </div>

          <button
            type="button"
            onClick={() =>
              update(i, { requiresPatchTest: !service.requiresPatchTest })
            }
            aria-pressed={service.requiresPatchTest}
            className={cn(
              STATUS_BADGE,
              "cursor-pointer transition-colors",
              service.requiresPatchTest
                ? PATCH_TEST_BADGE
                : "bg-muted text-muted-foreground border-border hover:text-foreground"
            )}
          >
            {service.requiresPatchTest ? "Patch test" : "No patch test"}
          </button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label={`Remove ${service.name || "service"}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          {rebook && (
            <div className="flex w-full flex-wrap items-center gap-1.5 pl-0.5 text-xs text-muted-foreground">
              <span>Due again after</span>
              <Input
                type="number"
                min={REBOOK_WEEKS_MIN}
                max={REBOOK_WEEKS_MAX}
                placeholder="—"
                value={service.rebookWeeks ?? ""}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  update(i, {
                    rebookWeeks: n >= REBOOK_WEEKS_MIN ? Math.min(n, REBOOK_WEEKS_MAX) : undefined,
                  });
                }}
                className="h-7 w-16"
                aria-label={`Weeks until ${service.name || "this service"} is due again`}
              />
              <span>weeks</span>
              {service.rebookWeeks ? (
                <>
                  <span>as</span>
                  <Input
                    value={service.rebookAs ?? ""}
                    placeholder={service.name || "the same"}
                    maxLength={120}
                    onChange={(e) => update(i, { rebookAs: e.target.value || undefined })}
                    className="h-7 min-w-[8rem] flex-1"
                    aria-label={`What ${service.name || "this service"} is rebooked as`}
                  />
                </>
              ) : (
                <span>(blank: no rebooking text)</span>
              )}
            </div>
          )}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" />
        Add service
      </Button>

      <p className="text-xs text-muted-foreground">
        Duration decides how much of the stylist&apos;s day is blocked. Colour services
        should be marked as needing a patch test — that forces a 48-hour gap
        for anyone new. The price is a starting figure: the desk starts from it,
        and the receptionist and chat bots quote it as &ldquo;from&rdquo;. What
        gets counted in the sales report is what was actually taken.
      </p>
    </div>
  );
}
