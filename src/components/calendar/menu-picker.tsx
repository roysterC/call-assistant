"use client";

/**
 * Choosing what is booked from the salon's menu (src/lib/nail-menu.ts), as
 * a nail tech says it: the treatment, which of its services, the finish,
 * then any extras. Several treatments can be chosen (a manicure and a
 * pedicure), each with its own finish.
 *
 * The picker holds no booking of its own: it reads and writes the list of
 * service names the booking form already books (combineServices), so the
 * length, the price, the fit in the diary and the Book button all work as
 * they did for a flat list. "Acrylic infill, French tip" and "Nail art,
 * tier 2" are what it adds.
 */

import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useT } from "@/components/providers/language-provider";
import { formatMoney } from "@/lib/money";
import { bookedName, flattenMenuWithPlaces, type MenuPlace, type SalonMenu } from "@/lib/nail-menu";
import { cn } from "@/lib/utils";

/**
 * Whether to choose from the menu: it has finishes or extras to choose (a
 * menu made from a flat list has neither, and its services are better ticked
 * as cards, several from one group), and every name already chosen is one
 * it makes, so the picker can show them.
 */
export function menuCovers(menu: SalonMenu | null | undefined, names: string[]): menu is SalonMenu {
  if (!menu || menu.treatments.length === 0) return false;
  if (menu.extras.length === 0 && menu.treatments.every((x) => x.finishes.length === 0)) return false;
  const { places } = flattenMenuWithPlaces(menu);
  return names.every((n) => places.has(n.toLowerCase()));
}

export function MenuPicker({
  menu,
  picked,
  onChange,
}: {
  menu: SalonMenu;
  /** The service names chosen, as the booking form books them. */
  picked: string[];
  onChange: (names: string[]) => void;
}) {
  const { t } = useT();
  const { places } = useMemo(() => flattenMenuWithPlaces(menu), [menu]);

  // What is chosen, read back from the names: per treatment its service and
  // finish, and the extras.
  const chosen = new Map<string, { kind: number; finish: number }>();
  const extrasOn: string[] = [];
  for (const name of picked) {
    const p: MenuPlace | undefined = places.get(name.toLowerCase());
    if (p?.type === "treatment") chosen.set(p.treatmentId, { kind: p.kind, finish: p.finish });
    else if (p?.type === "extra") extrasOn.push(p.extraId);
  }

  const [current, setCurrent] = useState<string>(() => menu.treatments.find((tr) => chosen.has(tr.id))?.id ?? menu.treatments[0]?.id ?? "");
  const tr = menu.treatments.find((x) => x.id === current) ?? menu.treatments[0];

  /** The names for a new choice: treatments in menu order, then extras. */
  function write(nextChosen: Map<string, { kind: number; finish: number }>, nextExtras: string[]) {
    const names: string[] = [];
    for (const x of menu.treatments) {
      const c = nextChosen.get(x.id);
      if (!c) continue;
      const kind = x.kinds[c.kind];
      if (kind) names.push(bookedName(kind, x.finishes[c.finish] ?? null));
    }
    // An extra stays only while something chosen can take it.
    const allowed = new Set(menu.treatments.filter((x) => nextChosen.has(x.id)).flatMap((x) => x.extras));
    for (const e of menu.extras) if (nextExtras.includes(e.id) && allowed.has(e.id)) names.push(e.name);
    onChange(names);
  }

  if (!tr) return null;
  const mine = chosen.get(tr.id);
  const offered = menu.extras.filter((e) =>
    menu.treatments.some((x) => (chosen.has(x.id) || x.id === tr.id) && x.extras.includes(e.id))
  );
  const pill = (on: boolean) =>
    on ? "border-foreground bg-foreground text-background" : "border-tea-green-700 bg-card hover:bg-tea-green-900";

  return (
    <div className="grid gap-3">
      {/* 1 · Treatment */}
      <div className="flex flex-wrap gap-1.5 max-md:grid max-md:grid-cols-2" role="tablist" aria-label={t("form.treatment")}>
        {menu.treatments.map((x) => {
          const has = chosen.has(x.id);
          return (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === tr.id}
              onClick={() => setCurrent(x.id)}
              className={cn("flex h-10 items-center justify-center gap-1.5 rounded-xl border-[1.5px] px-3.5 text-[14px] font-bold", pill(x.id === tr.id))}
            >
              {x.name}
              {has && (
                <span
                  aria-label={t("form.chosen")}
                  className={cn(
                    "flex h-[18px] w-[18px] items-center justify-center rounded-full",
                    x.id === tr.id ? "bg-background text-foreground" : "bg-primary text-primary-foreground"
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Its services: one at a time; the chosen one again to clear it. */}
      <div className="grid gap-1.5" role="radiogroup" aria-label={tr.name}>
        {tr.kinds.map((k, i) => {
          const on = mine?.kind === i;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                const next = new Map(chosen);
                if (on) next.delete(tr.id);
                else next.set(tr.id, { kind: i, finish: mine?.finish ?? (tr.finishes.length ? 0 : -1) });
                write(next, extrasOn);
              }}
              className={cn(
                "flex min-h-[46px] items-center gap-2.5 rounded-xl border-[1.5px] px-3.5 text-left",
                on ? "border-primary bg-tea-green-900" : "border-tea-green-700 bg-card hover:border-tea-green-500"
              )}
            >
              <span className="min-w-0 flex-1 text-[14.5px] font-semibold">{k.name}</span>
              <span className="shrink-0 text-[13px] text-muted-foreground">{t("form.minShort", { n: k.durationMinutes })}</span>
              <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums">
                {k.priceMinor === null ? <span className="font-normal text-muted-foreground">{t("form.noPrice")}</span> : formatMoney(k.priceMinor)}
              </span>
            </button>
          );
        })}
      </div>

      {/* 2 · Finish, once a service is chosen. */}
      {mine && tr.finishes.length > 0 && (
        <div>
          <p className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">{t("form.finish")}</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("form.finish")}>
            {tr.finishes.map((f, i) => {
              const on = mine.finish === i;
              const extra = [f.priceMinor ? `+${formatMoney(f.priceMinor)}` : "", f.minutes ? `+${t("form.minShort", { n: f.minutes })}` : ""]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => write(new Map(chosen).set(tr.id, { kind: mine.kind, finish: i }), extrasOn)}
                  className={cn("h-9 rounded-full border-[1.5px] px-3 text-[13.5px] font-semibold", pill(on))}
                >
                  {f.name}
                  {i > 0 && extra && <span className="opacity-70"> {extra}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3 · Extras, any number, on whatever is chosen. */}
      {chosen.size > 0 && offered.length > 0 && (
        <div>
          <p className="mb-1.5 text-[12.5px] font-bold text-muted-foreground">{t("form.extras")}</p>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((e) => {
              const on = extrasOn.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={on}
                  title={e.note}
                  onClick={() => write(chosen, on ? extrasOn.filter((x) => x !== e.id) : [...extrasOn, e.id])}
                  className={cn(
                    "flex h-9 items-center gap-1 rounded-full border-[1.5px] px-3 text-[13.5px] font-semibold",
                    on ? "border-primary bg-tea-green-900" : "border-tea-green-700 bg-card hover:border-tea-green-500"
                  )}
                >
                  {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                  {e.name}
                  {e.priceMinor !== null && <span className="font-normal text-muted-foreground">+{formatMoney(e.priceMinor)}</span>}
                  {e.photo && <span className="font-normal text-light-bronze-300">· {t("form.photoQuote")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
