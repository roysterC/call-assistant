"use client";

/**
 * What kind of business a salon is (src/lib/business-types.ts): one main
 * type, and any others it also offers. Used when a salon is created and on
 * its admin page.
 */

import { Button } from "@/components/ui/button";
import { BUSINESS_TYPES, PROFILES, type BusinessType } from "@/lib/business-types";
import { useT } from "@/components/providers/language-provider";
import type { MessageKey } from "@/lib/i18n";

export function BusinessTypePicker({
  main,
  also,
  onChange,
  audience = "admin",
}: {
  main: BusinessType;
  also: BusinessType[];
  onChange: (main: BusinessType, also: BusinessType[]) => void;
  /** "owner": in the salon's own words and language (onboarding). "admin": Kikai's. */
  audience?: "admin" | "owner";
}) {
  const { t: tr } = useT();
  const owner = audience === "owner";
  const label = (t: BusinessType) => (owner ? tr(`type.${t}` as MessageKey) : PROFILES[t].label);
  const mainHeading = owner ? tr("type.main") : "Business type";
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{mainHeading}</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={mainHeading}>
          {BUSINESS_TYPES.map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              role="radio"
              aria-checked={main === t}
              variant={main === t ? "default" : "outline"}
              onClick={() => onChange(t, also.filter((a) => a !== t))}
            >
              {label(t)}
            </Button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">{owner ? tr("type.also") : "Also offers"}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {BUSINESS_TYPES.filter((t) => t !== main).map((t) => {
            const on = also.includes(t);
            return (
              <Button
                key={t}
                type="button"
                size="sm"
                aria-pressed={on}
                variant={on ? "default" : "outline"}
                onClick={() => onChange(main, on ? also.filter((a) => a !== t) : [...also, t])}
              >
                {label(t)}
              </Button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {owner
            ? tr("type.ownerHint")
            : "Changes what the receptionist and chat know about the trade: what the team are called, which questions it asks, the words the phone listens for. The diary works the same for every type."}
        </p>
      </div>
    </div>
  );
}
