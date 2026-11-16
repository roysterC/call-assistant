"use client";

import { useState } from "react";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SalonService } from "@/lib/salon-config";
import { formatMoneyShort, minorToInput, parseMoney } from "@/lib/money";
import { useT } from "@/components/providers/language-provider";
import { useMe } from "@/components/providers/me-provider";
import { classifyService, familyChoices, familyHue } from "@/lib/service-colours";
import type { MessageKey } from "@/lib/i18n";
import { LengthStepper, ServiceSheet, serviceLength } from "@/components/settings/service-sheet";

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
 * Services sit in a card for each colour they have in the diary (Manicures,
 * Sets & infills…), each row a name, a length and a price that all line up.
 * Everything else (the colour, the patch test, the rebooking text) is in the
 * service's own sheet (service-sheet.tsx), behind its ⋯. A phone shows each
 * service as a line to tap, which opens the same sheet.
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
  // A row just added in a card, whose name box takes the cursor.
  const [added, setAdded] = useState<number | null>(null);

  function update(index: number, patch: Partial<SalonService>) {
    const next = [...value];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function add(group?: string): number {
    onChange([...value, { name: "", durationMinutes: 45, requiresPatchTest: false, priceMinor: null, ...(group ? { group } : {}) }]);
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
  const rebookLine = (s: SalonService) =>
    s.rebookWeeks
      ? s.rebookAs
        ? t("svc.rebookLineAs", { n: s.rebookWeeks, as: s.rebookAs })
        : t("svc.rebookLine", { n: s.rebookWeeks })
      : t("svc.rebookOff");
  const count = (n: number) => (n === 1 ? t("svc.countOne") : t("svc.countMany", { n }));

  const typicalTag = (
    <span
      className="rounded bg-light-bronze-800 px-1.5 py-0.5 text-[10.5px] font-semibold text-light-bronze-200"
      title={t("svc.typicalTitle")}
    >
      {t("svc.typical")}
    </span>
  );

  return (
    <div className="@container space-y-3">
      {value.length === 0 && <p className="text-sm text-muted-foreground">{t("svc.empty")}</p>}

      {/* A wide screen: a card for each colour, rows that line up. */}
      <div className="hidden items-start gap-4 md:grid @3xl:grid-cols-2">
        {groups.map((g) => (
          <section key={g.family} className="overflow-hidden rounded-[18px] border border-border bg-card">
            <div className="flex items-center gap-2.5 border-b border-tea-green-800 px-4 py-3" style={{ background: `${g.hue}14` }}>
              <span className="h-3 w-3 rounded-[4px]" style={{ background: g.hue }} aria-hidden="true" />
              <h3 className="text-[14.5px] font-bold">{familyLabel(g.family)}</h3>
              <span className="text-[12.5px] text-muted-foreground">{count(g.rows.length)}</span>
            </div>
            <ul className="px-2.5 py-1.5">
              {g.rows.map(({ service, index }) => (
                <li
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem_1.75rem] items-center gap-2 border-b border-tea-green-900 py-1.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <input
                      value={service.name}
                      placeholder={t("svc.untitled")}
                      autoFocus={added === index}
                      onChange={(e) => update(index, { name: e.target.value })}
                      aria-label={t("svc.name")}
                      className="h-[30px] w-full rounded-lg border-[1.5px] border-transparent bg-transparent px-1.5 text-[14.5px] font-semibold hover:bg-tea-green-900 focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    />
                    {(rebook || service.requiresPatchTest || typical?.(service)) && (
                      <div className="flex items-center gap-1.5 truncate px-[7px] text-xs text-muted-foreground">
                        {typical?.(service) && typicalTag}
                        {service.requiresPatchTest && <span className="font-semibold text-light-bronze-300">{t("svc.patch")}</span>}
                        {rebook && <span className="truncate">{rebookLine(service)}</span>}
                      </div>
                    )}
                  </div>
                  <LengthStepper
                    minutes={service.durationMinutes}
                    onChange={(durationMinutes) => update(index, { durationMinutes })}
                    flag={typical?.(service)}
                    t={t}
                  />
                  <span className="relative block">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">£</span>
                    <input
                      // Keyed by the price, so one filled in from a price list
                      // (services-import.tsx) shows instead of the old one.
                      key={`${index}-${service.priceMinor}`}
                      inputMode="decimal"
                      placeholder="—"
                      defaultValue={minorToInput(service.priceMinor)}
                      onBlur={(e) => update(index, { priceMinor: parseMoney(e.target.value) })}
                      aria-label={t("svc.price")}
                      className="h-8 w-full rounded-[9px] border-[1.5px] border-tea-green-700 bg-card pl-6 pr-2 text-right text-sm tabular-nums focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(index)}
                    aria-label={t("svc.more", { name: name(service) })}
                    className="flex h-8 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-tea-green-800 hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setAdded(add(g.family))}
              className="mx-2.5 mb-2 flex h-9 w-[calc(100%-1.25rem)] items-center gap-1.5 rounded-[9px] px-2 text-[13px] font-semibold text-tea-green-200 hover:bg-tea-green-900"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("svc.addTo", { group: familyLabel(g.family).toLowerCase() })}
            </button>
          </section>
        ))}
      </div>

      {/* A phone: a line for each service; tap it for the rest. */}
      <div className="space-y-1 md:hidden">
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
                    className="flex min-h-[52px] w-full items-center gap-2.5 py-2 pl-3.5 pr-3 text-left"
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
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-semibold hover:bg-tea-green-900 md:h-9 md:w-auto md:px-3.5 md:text-[13px]"
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
