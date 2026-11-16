"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SalonService } from "@/lib/salon-config";
import { formatMoneyShort } from "@/lib/money";
import { useT } from "@/components/providers/language-provider";
import { useMe } from "@/components/providers/me-provider";
import { classifyService, familyChoices, familyHue } from "@/lib/service-colours";
import type { MessageKey } from "@/lib/i18n";
import { ServiceSheet, serviceLength } from "@/components/settings/service-sheet";

/**
 * The price list: services and how long each takes.
 *
 * Duration is the load-bearing field. It decides how much of a stylist's day
 * gets blocked, so a three-hour balayage entered as thirty minutes will be
 * offered into gaps it cannot possibly fit — and the salon finds out when the
 * client is already in the chair.
 *
 * The patch-test flag carries real liability: it forces a 48-hour lead time
 * for anyone the salon has not seen before.
 *
 * Services sit under the colour they have in the diary (Manicures, Sets &
 * infills…), each a line with its name, length and price. Clicking one opens
 * its sheet (service-sheet.tsx) with everything else: the colour, the patch
 * test, the rebooking text.
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
  // The diary colour families this salon's trades have (service-colours.ts).
  const types = me?.businessTypes;
  const families = familyChoices(types);
  const familyLabel = (id: string) => t(`family.${id}` as MessageKey);
  // The service open in its sheet, by its place in the list.
  const [open, setOpen] = useState<number | null>(null);

  function update(index: number, patch: Partial<SalonService>) {
    const next = [...value];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function add(): number {
    onChange([...value, { name: "", durationMinutes: 45, requiresPatchTest: false, priceMinor: null }]);
    return value.length;
  }

  function remove(index: number) {
    onChange(value.filter((_, j) => j !== index));
    setOpen(null);
  }

  // Each service under the colour it has in the diary, in the order the
  // salon's trades list them; the order within each is the salon's own.
  const familyOf = (s: SalonService) => classifyService(s.name, s.requiresPatchTest, types, s.group);
  const order = [...families, ...new Set(value.map(familyOf).filter((f) => !families.includes(f)))];
  const groups = order
    .map((family) => ({
      family,
      hue: familyHue(family, types),
      rows: value.map((service, index) => ({ service, index })).filter(({ service }) => familyOf(service) === family),
    }))
    .filter((g) => g.rows.length > 0);

  const name = (s: SalonService) => s.name || t("svc.thisService");

  const typicalTag = (
    <span
      className="rounded bg-light-bronze-800 px-1.5 py-0.5 text-[10.5px] font-semibold text-light-bronze-200"
      title={t("svc.typicalTitle")}
    >
      {t("svc.typical")}
    </span>
  );

  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-sm text-muted-foreground">{t("svc.empty")}</p>}

      {/* A line for each service: its name, length and price; click it for the rest. */}
      <div className="space-y-1">
        {groups.map((g) => (
          <div key={g.family}>
            <p className="flex items-center gap-2 px-0.5 pb-1.5 pt-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: g.hue }} aria-hidden="true" />
              {familyLabel(g.family)}
            </p>
            <ul className="overflow-hidden rounded-[14px] border border-border bg-card">
              {g.rows.map(({ service, index }) => (
                <li key={index} className="border-b border-tea-green-900 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpen(index)}
                    aria-label={t("svc.edit", { name: name(service) })}
                    className="flex min-h-[52px] w-full items-center gap-2.5 py-2 pl-3.5 pr-3 text-left transition-colors hover:bg-tea-green-900"
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[15px] font-semibold", !service.name && "text-muted-foreground")}>
                        {service.name || t("svc.untitled")}
                      </span>
                      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                        {serviceLength(service.durationMinutes)}
                        {typical?.(service) && typicalTag}
                        {service.requiresPatchTest && <> · {t("svc.patch")}</>}
                        {rebook && service.rebookWeeks ? <> · {t("svc.againIn", { n: service.rebookWeeks })}</> : null}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[15px] font-bold tabular-nums",
                        service.priceMinor === null && "text-sm font-semibold text-light-bronze-300"
                      )}
                    >
                      {service.priceMinor === null ? t("svc.setPrice") : formatMoneyShort(service.priceMinor)}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen(add())}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-semibold hover:bg-tea-green-900 md:h-10 md:w-auto md:px-4"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("svc.add")}
      </button>

      <p className="text-xs text-muted-foreground">
        {t("svc.help")}
        {showSkinTests && <> {t("svc.patchHelp")}</>}
      </p>

      <ServiceSheet
        service={open === null ? null : value[open] ?? null}
        others={value.map((s) => s.name)}
        families={families}
        types={types}
        showSkinTest={showSkinTests || (open !== null && !!value[open]?.requiresPatchTest)}
        rebook={rebook}
        onChange={(patch) => open !== null && update(open, patch)}
        onDelete={() => open !== null && remove(open)}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
