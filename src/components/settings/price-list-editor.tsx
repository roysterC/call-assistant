"use client";

/**
 * The price list as a nail salon thinks of it (src/lib/nail-menu.ts): each
 * treatment with its services, lengths and prices, the finishes they come in
 * and the extras that can go on them; then the extras themselves.
 *
 * A treatment opens in a drawer with every part of it in one place (a sheet
 * from the bottom on a phone); an extra in a smaller card of its own. What
 * the phone, the chats and the diary book is made from this when it is
 * saved, one service per service and finish ("Acrylic infill, French tip"),
 * which the drawer shows as it is edited.
 */

import { useState, type ReactNode } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, PHONE_SHEET } from "@/components/ui/dialog";
import { useT } from "@/components/providers/language-provider";
import { formatMoneyShort, minorToInput, parseMoney } from "@/lib/money";
import { REBOOK_WEEKS_MAX } from "@/lib/salon-config";
import { classifyService, familyChoices, familyHue } from "@/lib/service-colours";
import {
  bookedName,
  clashingNames,
  uniqueId,
  type MenuExtra,
  type MenuKind,
  type MenuTreatment,
  type SalonMenu,
} from "@/lib/nail-menu";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type T = ReturnType<typeof useT>["t"];

/** "45 min", "1h 15". */
export function serviceLength(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h ${min % 60}` : `${h}h`;
}

/** A drawer down the right on a wide screen, a sheet from the bottom on a phone. */
const DRAWER = "md:m-0 md:ml-auto md:h-dvh md:max-h-dvh md:w-[460px] md:max-w-none md:rounded-none";
const label = "text-[12.5px] font-bold text-muted-foreground";
const box =
  "h-10 w-full min-w-0 rounded-[10px] border-[1.5px] border-tea-green-600 bg-card px-2.5 text-[15px] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** The treatment's diary colour: the one chosen, else its first service's. */
function treatmentFamily(t: MenuTreatment): string {
  return t.group ?? classifyService(t.kinds[0]?.name ?? t.name);
}

/** "Nail art, tier 1", "Nail art, tier 2" as "tier 1, tier 2": a lead-in two or more share is said once by the heading. */
function shortNames(names: string[]): string[] {
  const lead = (n: string) => (n.includes(", ") ? n.slice(0, n.indexOf(", ")) : null);
  return names.map((n) => {
    const l = lead(n);
    return l && names.filter((o) => lead(o) === l).length > 1 ? n.slice(l.length + 2) : n;
  });
}

/** "+£5 · +10 min", what a finish or an extra puts on top. */
function adds(priceMinor: number | null, minutes: number, t: T): string {
  const parts = [];
  if (priceMinor) parts.push(`+${formatMoneyShort(priceMinor)}`);
  if (minutes) parts.push(`+${serviceLength(minutes)}`);
  return parts.join(" · ") || t("menu.included");
}

export function PriceListEditor({
  value,
  onChange,
  rebook = false,
  importer,
}: {
  value: SalonMenu;
  onChange: (next: SalonMenu) => void;
  /** Show when each is due again, for rebooking texts (src/lib/rebook.ts). */
  rebook?: boolean;
  /** "Fill from a photo" (services-import.tsx), beside Add treatment. */
  importer?: ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<{ type: "treatment" | "extra"; id: string } | null>(null);

  const setTreatment = (id: string, next: MenuTreatment) =>
    onChange({ ...value, treatments: value.treatments.map((x) => (x.id === id ? next : x)) });
  const setExtra = (id: string, next: MenuExtra) => onChange({ ...value, extras: value.extras.map((x) => (x.id === id ? next : x)) });

  function addTreatment() {
    const id = uniqueId("treatment", value.treatments.map((x) => x.id));
    onChange({
      ...value,
      treatments: [...value.treatments, { id, name: "", kinds: [{ name: "", durationMinutes: 45, priceMinor: null }], finishes: [], extras: [] }],
    });
    setOpen({ type: "treatment", id });
  }

  function addExtra() {
    const id = uniqueId("extra", value.extras.map((x) => x.id));
    onChange({ ...value, extras: [...value.extras, { id, name: "", durationMinutes: 10, priceMinor: null }] });
    setOpen({ type: "extra", id });
  }

  const extraName = (id: string) => value.extras.find((e) => e.id === id)?.name;
  const clashes = clashingNames(value);
  const openTreatment = open?.type === "treatment" ? value.treatments.find((x) => x.id === open.id) ?? null : null;
  const openExtra = open?.type === "extra" ? value.extras.find((x) => x.id === open.id) ?? null : null;

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-2.5 md:max-w-[29rem]", importer ? "grid-cols-2" : "md:max-w-56")}>
        {importer}
        <button
          type="button"
          onClick={addTreatment}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("menu.addTreatment")}
        </button>
      </div>

      {value.treatments.length === 0 && <p className="text-sm text-muted-foreground">{t("menu.empty")}</p>}

      {value.treatments.map((tr) => {
        const on = shortNames(tr.extras.map(extraName).filter(Boolean) as string[]);
        const counts = [
          tr.kinds.length === 1 ? t("menu.services1") : t("menu.servicesN", { n: tr.kinds.length }),
          ...(tr.finishes.length ? [tr.finishes.length === 1 ? t("menu.finishes1") : t("menu.finishesN", { n: tr.finishes.length })] : []),
          ...(on.length ? [t("menu.extrasOn", { list: on.join(", ") })] : []),
        ].join(" · ");
        return (
          <section key={tr.id} className="overflow-hidden rounded-2xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setOpen({ type: "treatment", id: tr.id })}
              aria-label={t("menu.editTreatment", { name: tr.name || t("menu.newTreatment") })}
              className="flex w-full items-center gap-2.5 bg-tea-green-900/60 px-4 py-3 text-left transition-colors hover:bg-tea-green-900"
            >
              <span className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ background: familyHue(treatmentFamily(tr)) }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[15.5px] font-extrabold", !tr.name && "text-muted-foreground")}>
                  {tr.name || t("menu.newTreatment")}
                </span>
                <span className="block truncate text-[12.5px] text-muted-foreground">{counts}</span>
              </span>
              <span className="flex shrink-0 items-center text-[13px] font-semibold text-tea-green-200">
                {t("menu.edit")}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </button>
            <ul>
              {tr.kinds.map((k, i) => (
                <li key={i} className="flex min-h-[46px] items-center gap-2.5 border-t border-tea-green-900 px-4 py-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[14.5px] font-semibold", !k.name && "text-muted-foreground")}>
                    {k.name || t("menu.newService")}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[13px] text-muted-foreground tabular-nums">{serviceLength(k.durationMinutes)}</span>
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right text-[14.5px] font-bold tabular-nums",
                      k.priceMinor === null && "text-[13px] font-semibold text-light-bronze-300"
                    )}
                  >
                    {k.priceMinor === null ? t("svc.setPrice") : formatMoneyShort(k.priceMinor)}
                  </span>
                </li>
              ))}
            </ul>
            {tr.finishes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-tea-green-900 bg-background px-4 py-2.5">
                <span className="mr-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{t("menu.finishes")}</span>
                {tr.finishes.map((f, i) => (
                  <span key={i} className="rounded-full border border-border bg-card px-2.5 py-1 text-[12.5px]">
                    <strong className="font-semibold">{f.name}</strong>{" "}
                    <span className="text-muted-foreground">{i === 0 ? t("menu.included") : adds(f.priceMinor, f.minutes, t)}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Extras: on top of a treatment, never booked alone. */}
      <div className="pt-2">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="text-[15.5px] font-extrabold">{t("menu.extras")}</h3>
          <span className="text-[12.5px] text-muted-foreground phone:order-last phone:w-full">{t("menu.extrasHint")}</span>
          <button
            type="button"
            onClick={addExtra}
            className="ml-auto flex h-8 items-center gap-1 rounded-[9px] border border-border bg-card px-3 text-[12.5px] font-semibold hover:bg-tea-green-900"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("menu.addExtra")}
          </button>
        </div>
        {value.extras.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("menu.noExtras")}</p>
        ) : (
          <ul className="mt-2 overflow-hidden rounded-2xl border border-border bg-card">
            {value.extras.map((x) => (
              <li key={x.id} className="border-b border-tea-green-900 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen({ type: "extra", id: x.id })}
                  aria-label={t("menu.editExtra", { name: x.name || t("menu.newExtra") })}
                  className="flex min-h-[52px] w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors hover:bg-tea-green-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[14.5px] font-semibold", !x.name && "text-muted-foreground")}>
                      {x.name || t("menu.newExtra")}
                    </span>
                    {x.note && <span className="block truncate text-[12.5px] text-muted-foreground">{x.note}</span>}
                  </span>
                  {x.photo && (
                    <span className="shrink-0 rounded-full bg-light-bronze-800 px-2 py-0.5 text-[11.5px] font-bold text-light-bronze-200 phone:hidden">
                      {t("menu.photoQuote")}
                    </span>
                  )}
                  <span className="w-16 shrink-0 text-right text-[13px] text-muted-foreground tabular-nums">+{serviceLength(x.durationMinutes)}</span>
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right text-[14.5px] font-bold tabular-nums",
                      x.priceMinor === null && "text-[13px] font-semibold text-light-bronze-300"
                    )}
                  >
                    {x.priceMinor === null ? t("svc.setPrice") : `+${formatMoneyShort(x.priceMinor)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {clashes.length > 0 && (
        <p role="alert" className="rounded-xl bg-light-bronze-900 px-3.5 py-2.5 text-[13px] font-semibold text-light-bronze-200">
          {t("menu.clash", { names: clashes.join("; ") })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("menu.help")}</p>

      <Dialog open={openTreatment !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className={cn("gap-0 p-0 sm:max-w-[28rem]", PHONE_SHEET, DRAWER)}>
          {openTreatment && (
            <TreatmentFields
              treatment={openTreatment}
              extras={value.extras}
              rebook={rebook}
              onChange={(next) => setTreatment(openTreatment.id, next)}
              onDelete={() => {
                onChange({ ...value, treatments: value.treatments.filter((x) => x.id !== openTreatment.id) });
                setOpen(null);
              }}
              onClose={() => setOpen(null)}
              t={t}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openExtra !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className={cn("gap-0 p-0 sm:max-w-[26rem]", PHONE_SHEET)}>
          {openExtra && (
            <ExtraFields
              extra={openExtra}
              onChange={(next) => setExtra(openExtra.id, next)}
              onDelete={() => {
                onChange({
                  extras: value.extras.filter((x) => x.id !== openExtra.id),
                  treatments: value.treatments.map((tr) => ({ ...tr, extras: tr.extras.filter((id) => id !== openExtra.id) })),
                });
                setOpen(null);
              }}
              onClose={() => setOpen(null)}
              t={t}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A price typed as the person types it, read into pence as they leave the box. */
function MoneyBox({
  minor,
  onChange,
  label: aria,
  plus = false,
}: {
  minor: number | null;
  onChange: (minor: number | null) => void;
  label: string;
  plus?: boolean;
}) {
  const [text, setText] = useState(minorToInput(minor));
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">{plus ? "+£" : "£"}</span>
      <input
        inputMode="decimal"
        value={text}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(parseMoney(text))}
        aria-label={aria}
        className={cn(box, "tabular-nums", plus ? "pl-7" : "pl-6")}
      />
    </span>
  );
}

function MinutesBox({ minutes, onChange, label: aria }: { minutes: number; onChange: (m: number) => void; label: string }) {
  return (
    <input
      inputMode="numeric"
      value={minutes || ""}
      placeholder="0"
      onChange={(e) => {
        const n = Math.round(Number(e.target.value.replace(/\D/g, "")));
        if (Number.isFinite(n)) onChange(Math.min(n, 12 * 60));
      }}
      aria-label={aria}
      className={cn(box, "text-right tabular-nums")}
    />
  );
}

function TreatmentFields({
  treatment: tr,
  extras,
  rebook,
  onChange,
  onDelete,
  onClose,
  t,
}: {
  treatment: MenuTreatment;
  extras: MenuExtra[];
  rebook: boolean;
  onChange: (next: MenuTreatment) => void;
  onDelete: () => void;
  onClose: () => void;
  t: T;
}) {
  const setKind = (i: number, patch: Partial<MenuKind>) =>
    onChange({ ...tr, kinds: tr.kinds.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const family = treatmentFamily(tr);
  const familyLabel = (id: string) => t(`family.${id}` as MessageKey);
  const named = tr.kinds.filter((k) => k.name.trim());
  // What the phone and the diary will book, as it is typed.
  const booked = named.flatMap((k) => (tr.finishes.length ? tr.finishes.filter((f) => f.name.trim()) : [null]).map((f) => bookedName(k, f)));

  return (
    <div className="flex min-h-full flex-col gap-5 px-[18px] pb-5 pt-3 md:px-6 md:pt-5">
      <div className="mx-auto h-1.5 w-10 rounded-full bg-tea-green-700 md:hidden" aria-hidden="true" />
      <div className="flex items-center gap-2.5 pr-8">
        <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: familyHue(family) }} aria-hidden="true" />
        <DialogTitle className="min-w-0 truncate font-heading text-xl font-extrabold">{tr.name || t("menu.newTreatment")}</DialogTitle>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("menu.treatmentName")}</span>
        <input value={tr.name} onChange={(e) => onChange({ ...tr, name: e.target.value })} placeholder={t("price.exampleTreatment")} className={cn(box, "h-11")} />
      </label>

      {/* The services, each a row: name, minutes, from-price. */}
      <div>
        <p className={cn(label, "mb-2")}>{t("menu.kindsTitle")}</p>
        <div className="grid grid-cols-[minmax(0,1fr)_64px_76px_28px] items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">{t("menu.colName")}</span>
          <span className="text-right text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">{t("menu.colLength")}</span>
          <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">{t("menu.colPrice")}</span>
          <span />
          {tr.kinds.map((k, i) => (
            <KindRow
              key={i}
              kind={k}
              onChange={(patch) => setKind(i, patch)}
              onRemove={tr.kinds.length > 1 ? () => onChange({ ...tr, kinds: tr.kinds.filter((_, j) => j !== i) }) : undefined}
              t={t}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...tr, kinds: [...tr.kinds, { name: "", durationMinutes: tr.kinds.at(-1)?.durationMinutes ?? 45, priceMinor: null }] })}
          className="mt-1.5 flex h-8 items-center gap-1 rounded-lg px-1 text-[13px] font-semibold text-tea-green-200 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t("menu.addKind")}
        </button>
      </div>

      {/* Finishes: the first included, the others add to it. */}
      <div>
        <p className={cn(label, "mb-2")}>{t("menu.finishesTitle")}</p>
        {tr.finishes.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("menu.noFinishes")}</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_76px_64px_28px] items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">{t("menu.colName")}</span>
            <span className="col-span-2 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">{t("menu.colAdds")}</span>
            <span />
            {tr.finishes.map((f, i) => (
              <FinishRow
                key={i}
                first={i === 0}
                finish={f}
                onChange={(patch) => onChange({ ...tr, finishes: tr.finishes.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                onRemove={() => onChange({ ...tr, finishes: tr.finishes.filter((_, j) => j !== i) })}
                t={t}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onChange({ ...tr, finishes: [...tr.finishes, { name: "", priceMinor: 0, minutes: 0 }] })}
          className="mt-1.5 flex h-8 items-center gap-1 rounded-lg px-1 text-[13px] font-semibold text-tea-green-200 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t("menu.addFinish")}
        </button>
        {tr.finishes.length > 1 && <p className="mt-1 text-xs text-muted-foreground">{t("menu.finishesHelp")}</p>}
      </div>

      <div>
        <p className={cn(label, "mb-2")}>{t("menu.extrasTitle")}</p>
        {extras.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("menu.noExtrasYet")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {extras.map((x) => {
              const on = tr.extras.includes(x.id);
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      ...tr,
                      // Kept in the price list's order, which is the order the desk shows them in.
                      extras: on ? tr.extras.filter((id) => id !== x.id) : extras.filter((e) => e.id === x.id || tr.extras.includes(e.id)).map((e) => e.id),
                    })
                  }
                  className={cn(
                    "h-9 rounded-full border-[1.5px] px-3 text-[13px] font-semibold",
                    on ? "border-primary bg-tea-green-900" : "border-tea-green-700 bg-card hover:border-tea-green-400"
                  )}
                >
                  {on ? "✓" : "+"} {x.name || t("menu.newExtra")}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className={label}>{t("svc.colour")}</span>
        <div className="grid grid-cols-2 gap-1.5">
          {[undefined, ...familyChoices()].map((id) => {
            const on = tr.group === id;
            const auto = classifyService(tr.kinds[0]?.name ?? tr.name);
            return (
              <button
                key={id ?? "auto"}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...tr, group: id })}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-xl border-[1.5px] px-2.5 text-left text-[13px] font-semibold",
                  id === undefined && "col-span-2",
                  on ? "border-primary bg-tea-green-900" : "border-tea-green-700 bg-card hover:border-tea-green-400"
                )}
              >
                <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: familyHue(id ?? auto) }} aria-hidden="true" />
                <span className="min-w-0 truncate">{id === undefined ? t("svc.colourAuto", { group: familyLabel(auto) }) : familyLabel(id)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {rebook && named.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[14px] bg-tea-green-900 px-3.5 py-3">
          <span className={label}>{t("menu.rebookTitle")}</span>
          {tr.kinds.map((k, i) =>
            k.name.trim() ? (
              <RebookRow key={i} kind={k} others={named.filter((o) => o !== k).map((o) => o.name)} onChange={(patch) => setKind(i, patch)} t={t} />
            ) : null
          )}
          <span className="text-xs text-muted-foreground">{t("svc.rebookHelp")}</span>
        </div>
      )}

      {booked.length > 0 && (
        <div>
          <p className={cn(label, "mb-1.5")}>{t("menu.bookedAs")}</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{booked.join(" · ")}</p>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-1 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="h-[52px] rounded-[14px] bg-primary text-base font-bold text-primary-foreground md:h-11 md:text-[15px]"
        >
          {t("svc.done")}
        </button>
        <button type="button" onClick={onDelete} className="h-10 text-sm font-semibold text-red-700">
          {t("menu.deleteTreatment")}
        </button>
      </div>
    </div>
  );
}

function KindRow({
  kind,
  onChange,
  onRemove,
  t,
}: {
  kind: MenuKind;
  onChange: (patch: Partial<MenuKind>) => void;
  onRemove?: () => void;
  t: T;
}) {
  const name = kind.name || t("menu.newService");
  return (
    <>
      <input
        value={kind.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder={t("menu.newService")}
        aria-label={t("menu.colName")}
        className={box}
      />
      <MinutesBox minutes={kind.durationMinutes} onChange={(durationMinutes) => onChange({ durationMinutes })} label={`${name}: ${t("menu.colLength")}`} />
      <MoneyBox key={String(kind.priceMinor)} minor={kind.priceMinor} onChange={(priceMinor) => onChange({ priceMinor })} label={`${name}: ${t("menu.colPrice")}`} />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("menu.remove", { name })}
          className="flex h-10 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <span />
      )}
    </>
  );
}

function FinishRow({
  first,
  finish,
  onChange,
  onRemove,
  t,
}: {
  first: boolean;
  finish: { name: string; priceMinor: number; minutes: number };
  onChange: (patch: Partial<{ name: string; priceMinor: number; minutes: number }>) => void;
  onRemove: () => void;
  t: T;
}) {
  const name = finish.name || t("menu.newFinish");
  return (
    <>
      <input
        value={finish.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder={t("menu.newFinish")}
        aria-label={t("menu.colName")}
        className={box}
      />
      {first ? (
        <span className="col-span-2 flex h-10 items-center rounded-[10px] bg-tea-green-900 px-2.5 text-[13px] text-muted-foreground">
          {t("menu.included")}
        </span>
      ) : (
        <>
          <MoneyBox key={String(finish.priceMinor)} plus minor={finish.priceMinor} onChange={(m) => onChange({ priceMinor: m ?? 0 })} label={`${name}: ${t("menu.colAdds")}`} />
          <MinutesBox minutes={finish.minutes} onChange={(minutes) => onChange({ minutes })} label={`${name}: ${t("menu.minutes")}`} />
        </>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("menu.remove", { name })}
        className="flex h-10 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-red-700"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );
}

/** "Infill — due after 3 weeks, as: the same again". */
function RebookRow({
  kind,
  others,
  onChange,
  t,
}: {
  kind: MenuKind;
  others: string[];
  onChange: (patch: Partial<MenuKind>) => void;
  t: T;
}) {
  const weeks = kind.rebookWeeks ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13.5px]">
      <span className="min-w-0 flex-1 truncate font-semibold">{kind.name}</span>
      <span className="inline-flex items-center rounded-[11px] border-[1.5px] border-tea-green-600 bg-card">
        <button
          type="button"
          onClick={() => onChange({ rebookWeeks: weeks > 1 ? weeks - 1 : undefined })}
          disabled={!weeks}
          aria-label={t("svc.fewerWeeks")}
          className="h-9 w-9 text-lg disabled:opacity-35"
        >
          −
        </button>
        <span className="min-w-14 text-center font-bold tabular-nums">{weeks ? t("svc.weeksN", { n: weeks }) : t("svc.off")}</span>
        <button
          type="button"
          onClick={() => onChange({ rebookWeeks: Math.min(REBOOK_WEEKS_MAX, weeks + 1) })}
          disabled={weeks >= REBOOK_WEEKS_MAX}
          aria-label={t("svc.moreWeeks")}
          className="h-9 w-9 text-lg disabled:opacity-35"
        >
          +
        </button>
      </span>
      {weeks > 0 && others.length > 0 && (
        <select
          value={kind.rebookAs ?? ""}
          onChange={(e) => onChange({ rebookAs: e.target.value || undefined })}
          aria-label={t("svc.rebookAs", { name: kind.name })}
          className="h-9 w-full rounded-[10px] border-[1.5px] border-tea-green-600 bg-card px-2 text-[13px]"
        >
          <option value="">{t("menu.sameKind")}</option>
          {others.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ExtraFields({
  extra: x,
  onChange,
  onDelete,
  onClose,
  t,
}: {
  extra: MenuExtra;
  onChange: (next: MenuExtra) => void;
  onDelete: () => void;
  onClose: () => void;
  t: T;
}) {
  return (
    <div className="flex flex-col gap-4 px-[18px] pb-5 pt-3 md:px-6 md:pt-5">
      <div className="mx-auto h-1.5 w-10 rounded-full bg-tea-green-700 md:hidden" aria-hidden="true" />
      <DialogTitle className="truncate pr-8 font-heading text-xl font-extrabold">{x.name || t("menu.newExtra")}</DialogTitle>
      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("svc.name")}</span>
        <input value={x.name} onChange={(e) => onChange({ ...x, name: e.target.value })} placeholder={t("price.exampleExtra")} className={cn(box, "h-11")} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("menu.note")}</span>
        <input
          value={x.note ?? ""}
          onChange={(e) => onChange({ ...x, note: e.target.value || undefined })}
          placeholder={t("menu.notePlaceholder")}
          className={cn(box, "h-11")}
        />
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1.5">
          <span className={label}>
            {t("menu.adds")} ({t("menu.minutes")})
          </span>
          <MinutesBox minutes={x.durationMinutes} onChange={(durationMinutes) => onChange({ ...x, durationMinutes })} label={t("menu.minutes")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>{t("svc.priceFrom")}</span>
          <MoneyBox key={String(x.priceMinor)} plus minor={x.priceMinor} onChange={(priceMinor) => onChange({ ...x, priceMinor })} label={t("svc.price")} />
        </label>
      </div>
      <label className="flex items-center gap-3 rounded-[14px] bg-tea-green-900 px-3.5 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("menu.photoSwitch")}</span>
          <span className="block text-xs text-muted-foreground">{t("menu.photoHelp")}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(x.photo)}
          onClick={() => onChange({ ...x, photo: !x.photo || undefined })}
          className={cn("relative h-7 w-[46px] shrink-0 rounded-full transition-colors", x.photo ? "bg-primary" : "bg-tea-green-700")}
        >
          <span
            aria-hidden="true"
            className={cn("absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-[left]", x.photo ? "left-[21px]" : "left-[3px]")}
          />
        </button>
      </label>
      <button
        type="button"
        onClick={onClose}
        className="h-[52px] rounded-[14px] bg-primary text-base font-bold text-primary-foreground md:h-11 md:text-[15px]"
      >
        {t("svc.done")}
      </button>
      <button type="button" onClick={onDelete} className="-mt-1 h-10 text-sm font-semibold text-red-700">
        {t("menu.deleteExtra")}
      </button>
    </div>
  );
}
