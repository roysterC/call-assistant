"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, PATCH_TEST_BADGE } from "@/lib/status-styles";
import type { SalonService } from "@/lib/salon-config";
import { minorToInput, parseMoney } from "@/lib/money";
import { REBOOK_WEEKS_MAX, REBOOK_WEEKS_MIN } from "@/lib/salon-config";
import { useT } from "@/components/providers/language-provider";
import { useMe } from "@/components/providers/me-provider";

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
  skinTests,
  typical,
}: {
  value: SalonService[];
  onChange: (next: SalonService[]) => void;
  /** Show when each is due again, for rebooking texts (src/lib/rebook.ts). */
  rebook?: boolean;
  /**
   * Show the patch-test switch. Off for trades with no skin tests (nails,
   * barbers), where it only puzzles; a service already switched on still
   * shows it. Defaults to the salon's own types.
   */
  skinTests?: boolean;
  /** Which services still have the length we guessed, to mark for checking (onboarding). */
  typical?: (service: SalonService) => boolean;
}) {
  const { t } = useT();
  const me = useMe();
  const showSkinTests = skinTests ?? me?.skinTests ?? true;
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
      {value.length === 0 && <p className="text-sm text-muted-foreground">{t("svc.empty")}</p>}

      {value.map((service, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-2 rounded-md border p-2"
        >
          <Input
            value={service.name}
            placeholder={t("svc.name")}
            onChange={(e) => update(i, { name: e.target.value })}
            className="h-8 flex-1 min-w-[10rem]"
            aria-label={t("svc.name")}
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
              className={cn("h-8 w-20", typical?.(service) && "border-light-bronze-400 ring-2 ring-light-bronze-400/30")}
              aria-label={t("svc.minutes")}
            />
            <span className="text-xs text-muted-foreground">{t("svc.min")}</span>
            {typical?.(service) && (
              <span
                className="rounded bg-light-bronze-800 px-1.5 py-0.5 text-[10px] font-medium text-light-bronze-200"
                title={t("svc.typicalTitle")}
              >
                {t("svc.typical")}
              </span>
            )}
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
              aria-label={t("svc.price")}
            />
          </div>

          {(showSkinTests || service.requiresPatchTest) && (
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
            {service.requiresPatchTest ? t("svc.patch") : t("svc.noPatch")}
          </button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label={t("svc.remove", { name: service.name || t("svc.thisService") })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          {rebook && (
            <div className="flex w-full flex-wrap items-center gap-1.5 pl-0.5 text-xs text-muted-foreground">
              <span>{t("svc.dueAfter")}</span>
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
                aria-label={t("svc.weeksLabel", { name: service.name || t("svc.thisService") })}
              />
              <span>{t("svc.weeks")}</span>
              {service.rebookWeeks ? (
                <>
                  <span>{t("svc.as")}</span>
                  <Input
                    value={service.rebookAs ?? ""}
                    placeholder={service.name || t("svc.same")}
                    maxLength={120}
                    onChange={(e) => update(i, { rebookAs: e.target.value || undefined })}
                    className="h-7 min-w-[8rem] flex-1"
                    aria-label={t("svc.rebookAs", { name: service.name || t("svc.thisService") })}
                  />
                </>
              ) : (
                <span>{t("svc.noRebook")}</span>
              )}
            </div>
          )}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" />
        {t("svc.add")}
      </Button>

      <p className="text-xs text-muted-foreground">
        {t("svc.help")}
        {showSkinTests && <> {t("svc.patchHelp")}</>}
      </p>
    </div>
  );
}
