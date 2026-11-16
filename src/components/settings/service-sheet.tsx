"use client";

/**
 * One service, every detail labelled: its name, how long it takes, its price,
 * its colour in the diary, whether it needs a patch test, and its rebooking
 * text. A sheet from the bottom on a phone, a card in the middle elsewhere.
 * Opened from the price list (services-editor.tsx): by tapping a service on
 * a phone, or its ⋯ on a wide screen.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, PHONE_SHEET } from "@/components/ui/dialog";
import { useT } from "@/components/providers/language-provider";
import { minorToInput, parseMoney } from "@/lib/money";
import { REBOOK_WEEKS_MAX, type SalonService } from "@/lib/salon-config";
import type { MessageKey } from "@/lib/i18n";
import type { BusinessType } from "@/lib/business-types";
import { classifyService, familyHue } from "@/lib/service-colours";
import { cn } from "@/lib/utils";

const QUICK_LENGTHS = [15, 20, 30, 45, 60, 75, 90, 120];

export function serviceLength(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h ${min % 60}` : `${h}h`;
}

const label = "text-[12.5px] font-bold text-muted-foreground";
const field =
  "h-12 w-full rounded-xl border-[1.5px] border-tea-green-600 bg-card px-3.5 text-base focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-11 md:text-[15px]";

export function ServiceSheet({
  service,
  others,
  families,
  types,
  showSkinTest,
  rebook,
  onChange,
  onDelete,
  onClose,
}: {
  /** Null when no service is open. */
  service: SalonService | null;
  /** The other services' names, for what a rebooking text books them in for. */
  others: string[];
  families: string[];
  types?: readonly BusinessType[] | null;
  showSkinTest: boolean;
  rebook: boolean;
  onChange: (patch: Partial<SalonService>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog open={service !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("gap-0 p-0 sm:max-w-[26rem]", PHONE_SHEET)}>
        {service && (
          <Fields
            service={service}
            others={others}
            families={families}
            types={types}
            showSkinTest={showSkinTest}
            rebook={rebook}
            onChange={onChange}
            onDelete={onDelete}
            onClose={onClose}
            t={t}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Fields({
  service,
  others,
  families,
  types,
  showSkinTest,
  rebook,
  onChange,
  onDelete,
  onClose,
  t,
}: Omit<Parameters<typeof ServiceSheet>[0], "service"> & {
  service: SalonService;
  t: ReturnType<typeof useT>["t"];
}) {
  // The price as typed; read into pence as it leaves the box.
  const [price, setPrice] = useState(minorToInput(service.priceMinor));
  const auto = classifyService(service.name, service.requiresPatchTest, types);
  const shown = classifyService(service.name, service.requiresPatchTest, types, service.group);
  const familyLabel = (id: string) => t(`family.${id}` as MessageKey);
  const swatch = (id: string) => familyHue(id as Parameters<typeof familyHue>[0], types);
  const weeks = service.rebookWeeks ?? 0;
  // What a rebooking text can book them in for: the same again, another
  // service, or what was typed before this list existed.
  const asChoices = [...new Set([...others.filter((o) => o && o !== service.name), ...(service.rebookAs ? [service.rebookAs] : [])])];

  const colourButton = (id: string | undefined, text: string, hue: string) => {
    const on = (service.group ?? undefined) === id;
    return (
      <button
        key={id ?? "auto"}
        type="button"
        aria-pressed={on}
        onClick={() => onChange({ group: id })}
        className={cn(
          "flex h-11 items-center gap-2 rounded-xl border-[1.5px] px-2.5 text-left text-[13px] font-semibold md:h-10",
          // "Automatic: Sets & infills" needs the room.
          id === undefined && "col-span-2",
          on ? "border-primary bg-tea-green-900" : "border-tea-green-700 bg-card hover:border-tea-green-400"
        )}
      >
        <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: hue }} aria-hidden="true" />
        <span className="min-w-0 truncate">{text}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 px-[18px] pb-5 pt-3 md:px-6 md:pt-5">
      <div className="mx-auto h-1.5 w-10 rounded-full bg-tea-green-700 md:hidden" aria-hidden="true" />
      <div className="flex items-center gap-2.5 pr-8">
        <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: swatch(shown) }} aria-hidden="true" />
        <DialogTitle className="min-w-0 truncate font-heading text-xl font-extrabold">
          {service.name || t("svc.untitled")}
        </DialogTitle>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("svc.name")}</span>
        <input
          value={service.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t("svc.untitled")}
          className={field}
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className={label}>{t("svc.length")}</span>
        <div className="grid grid-cols-4 gap-1.5">
          {QUICK_LENGTHS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={service.durationMinutes === m}
              onClick={() => onChange({ durationMinutes: m })}
              className={cn(
                "h-10 rounded-[11px] border-[1.5px] text-sm font-semibold tabular-nums md:h-9 md:text-[13px]",
                service.durationMinutes === m
                  ? "border-foreground bg-foreground text-background"
                  : "border-tea-green-600 bg-card hover:border-tea-green-400"
              )}
            >
              {serviceLength(m)}
            </button>
          ))}
        </div>
        {!QUICK_LENGTHS.includes(service.durationMinutes) && (
          <LengthStepper
            minutes={service.durationMinutes}
            onChange={(durationMinutes) => onChange({ durationMinutes })}
            t={t}
            className="self-start"
          />
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("svc.priceFrom")}</span>
        <span className="relative block md:w-40">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
          <input
            inputMode="decimal"
            value={price}
            placeholder="—"
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => onChange({ priceMinor: parseMoney(price) })}
            aria-label={t("svc.price")}
            className={cn(field, "pl-7 tabular-nums")}
          />
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className={label}>{t("svc.colour")}</span>
        <div className="grid grid-cols-2 gap-1.5">
          {colourButton(undefined, t("svc.colourAuto", { group: familyLabel(auto) }), swatch(auto))}
          {families.map((f) => colourButton(f, familyLabel(f), swatch(f)))}
        </div>
      </div>

      {showSkinTest && (
        <label className="flex items-center gap-3 rounded-[14px] bg-tea-green-900 px-3.5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("svc.skinTest")}</span>
            <span className="block text-xs text-muted-foreground">{t("svc.patchHelp")}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={service.requiresPatchTest}
            onClick={() => onChange({ requiresPatchTest: !service.requiresPatchTest })}
            className={cn(
              "relative h-7 w-[46px] shrink-0 rounded-full transition-colors",
              service.requiresPatchTest ? "bg-primary" : "bg-tea-green-700"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-[left]",
                service.requiresPatchTest ? "left-[21px]" : "left-[3px]"
              )}
            />
          </button>
        </label>
      )}

      {rebook && (
        <div className="flex flex-col gap-2.5 rounded-[14px] bg-tea-green-900 px-3.5 py-3">
          <span className={label}>{t("svc.rebookTitle")}</span>
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex-1">{t("svc.dueAfter")}</span>
            <span className="inline-flex items-center rounded-[11px] border-[1.5px] border-tea-green-600 bg-card">
              <button
                type="button"
                onClick={() => onChange({ rebookWeeks: weeks > 1 ? weeks - 1 : undefined })}
                disabled={!weeks}
                aria-label={t("svc.fewerWeeks")}
                className="h-10 w-10 text-lg disabled:opacity-35 md:h-9 md:w-9"
              >
                −
              </button>
              <span className="min-w-14 text-center font-bold tabular-nums">
                {weeks ? t("svc.weeksN", { n: weeks }) : t("svc.off")}
              </span>
              <button
                type="button"
                onClick={() => onChange({ rebookWeeks: Math.min(REBOOK_WEEKS_MAX, weeks + 1) })}
                disabled={weeks >= REBOOK_WEEKS_MAX}
                aria-label={t("svc.moreWeeks")}
                className="h-10 w-10 text-lg disabled:opacity-35 md:h-9 md:w-9"
              >
                +
              </button>
            </span>
          </div>
          {weeks > 0 && (
            <label className="flex items-center gap-2.5 text-sm">
              <span className="shrink-0">{t("svc.bookAs")}</span>
              <select
                value={service.rebookAs ?? ""}
                onChange={(e) => onChange({ rebookAs: e.target.value || undefined })}
                aria-label={t("svc.rebookAs", { name: service.name || t("svc.thisService") })}
                className="h-10 min-w-0 flex-1 rounded-[10px] border-[1.5px] border-tea-green-600 bg-card px-2 text-[13.5px] md:h-9"
              >
                <option value="">{t("svc.sameAgain")}</option>
                {asChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="text-xs text-muted-foreground">{weeks ? t("svc.rebookHelp") : t("svc.rebookOffHelp")}</span>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="h-[52px] rounded-[14px] bg-primary text-base font-bold text-primary-foreground md:h-11 md:text-[15px]"
      >
        {t("svc.done")}
      </button>
      <button type="button" onClick={onDelete} className="-mt-1 h-10 text-sm font-semibold text-red-700">
        {t("svc.delete")}
      </button>
    </div>
  );
}

/** − 45 min +, five minutes a step. */
export function LengthStepper({
  minutes,
  onChange,
  t,
  className,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  t: ReturnType<typeof useT>["t"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center rounded-[9px] border-[1.5px] border-tea-green-700 bg-card",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(5, minutes - 5))}
        aria-label={t("svc.shorter")}
        className="h-full w-[30px] rounded-l-[8px] hover:bg-tea-green-800"
      >
        −
      </button>
      <input
        inputMode="numeric"
        value={minutes}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value.replace(/\D/g, "")));
          if (Number.isFinite(n)) onChange(n);
        }}
        aria-label={t("svc.minutes")}
        className="h-full w-9 bg-transparent text-right text-[13.5px] font-semibold tabular-nums focus-visible:outline-none"
      />
      <span className="pl-1 pr-0.5 text-[12.5px] text-muted-foreground">{t("svc.min")}</span>
      <button
        type="button"
        onClick={() => onChange(minutes + 5)}
        aria-label={t("svc.longer")}
        className="h-full w-[30px] rounded-r-[8px] hover:bg-tea-green-800"
      >
        +
      </button>
    </span>
  );
}
