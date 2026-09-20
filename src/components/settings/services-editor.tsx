"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, PATCH_TEST_BADGE } from "@/lib/status-styles";
import type { SalonService } from "@/lib/salon-config";
import { minorToInput, parseMoney } from "@/lib/money";

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
}: {
  value: SalonService[];
  onChange: (next: SalonService[]) => void;
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
        bufferMinutes: 0,
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

          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              step={5}
              value={service.bufferMinutes}
              onChange={(e) =>
                update(i, { bufferMinutes: Number(e.target.value) })
              }
              className="h-8 w-20"
              aria-label="Tidy-up buffer in minutes"
            />
            <span className="text-xs text-muted-foreground">tidy-up</span>
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
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" />
        Add service
      </Button>

      <p className="text-xs text-muted-foreground">
        Duration decides how much of the stylist&apos;s day is blocked. Tidy-up
        time is kept free afterwards but may run past closing. Colour services
        should be marked as needing a patch test — that forces a 48-hour gap
        for anyone new. The price is a starting figure for the desk; what gets
        counted in the sales report is what was actually taken.
      </p>
    </div>
  );
}
