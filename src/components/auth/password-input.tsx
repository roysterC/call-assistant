"use client";

/**
 * A new password, typed once with an eye to show it: on a phone, typing it
 * twice blind is where people give up or get it wrong.
 */

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/language-provider";

export function PasswordInput({
  id,
  value,
  onChange,
  autoFocus,
  autoComplete = "new-password",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        minLength={8}
        required
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t("pw.hide") : t("pw.show")}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
