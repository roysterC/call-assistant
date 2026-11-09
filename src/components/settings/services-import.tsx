"use client";

/**
 * "Fill from a photo or file": the salon's price list read by the server
 * (api/settings/services/import, src/lib/price-import.ts), checked here row
 * by row, then added to the services editor. Nothing is saved until the
 * owner saves Settings as usual.
 *
 * Photos are shrunk on the device first: a phone photo is several
 * megabytes, which is slow on salon wifi and more than the model needs to
 * read a menu. HEIC from an iPhone comes out as JPEG the same way.
 */

import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, PATCH_TEST_BADGE } from "@/lib/status-styles";
import { minorToInput, parseMoney } from "@/lib/money";
import { useT } from "@/components/providers/language-provider";
import type { SalonService } from "@/lib/salon-config";
import { IMPORT_LIMITS, mergeIntoServices, type ImportResult, type ImportRow } from "@/lib/price-import";

/** Long side of a shrunk photo: plenty to read small print on a menu. */
const MAX_SIDE = 1600;

const FLAG = cn(STATUS_BADGE, "bg-muted text-muted-foreground border-border");
const WARN = cn(STATUS_BADGE, PATCH_TEST_BADGE);

type Step = "pick" | "reading" | "review";
type Kept = ImportRow & { keep: boolean };

export function ServicesImport({
  services,
  onApply,
}: {
  services: SalonService[];
  onApply: (next: SalonService[]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("pick");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Kept[]>([]);
  const [skipped, setSkipped] = useState<ImportResult["skipped"]>([]);
  const picker = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("pick");
    setFiles([]);
    setRows([]);
    setSkipped([]);
    setError(null);
  }

  function add(list: FileList | null) {
    setError(null);
    const next = [...files, ...Array.from(list ?? [])];
    if (next.length > IMPORT_LIMITS.files) setError(t("import.tooMany"));
    setFiles(next.slice(0, IMPORT_LIMITS.files));
    if (picker.current) picker.current.value = "";
  }

  async function read() {
    setError(null);
    setStep("reading");
    try {
      const form = new FormData();
      for (const f of files) {
        const shrunk = await shrink(f);
        if (!shrunk) {
          setError(t("import.unreadable", { name: f.name }));
          setStep("pick");
          return;
        }
        form.append("files", shrunk);
      }
      const res = await apiFetch("/api/settings/services/import", { method: "POST", body: form });
      if (res.status === 413) {
        setError(t("import.tooBig"));
        setStep("pick");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
      if (!res.ok || !data.rows) {
        setError(data.error ?? t("import.failed"));
        setStep("pick");
        return;
      }
      setRows(data.rows.map((r) => ({ ...r, keep: true })));
      setSkipped(data.skipped ?? []);
      setStep("review");
    } catch {
      setError(t("import.failed"));
      setStep("pick");
    }
  }

  function update(i: number, patch: Partial<Kept>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  const kept = rows.filter((r) => r.keep && r.name.trim());

  function apply() {
    onApply(mergeIntoServices(services, kept));
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Camera className="h-4 w-4 mr-1" />
        {t("import.button")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("import.title")}</DialogTitle>
            <DialogDescription>{step === "review" ? t("import.reviewIntro") : t("import.intro")}</DialogDescription>
          </DialogHeader>

          {step === "pick" && (
            <div className="space-y-3">
              <input
                ref={picker}
                type="file"
                multiple
                accept="image/*,application/pdf,.pdf,.csv,.txt,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => add(e.target.files)}
              />
              <Button type="button" variant="outline" onClick={() => picker.current?.click()}>
                <Camera className="h-4 w-4 mr-1" />
                {t("import.choose")}
              </Button>
              {files.length > 0 && (
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                      <span className="truncate">{f.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("import.remove", { name: f.name })}
                        onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "reading" && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("import.reading")}
            </p>
          )}

          {step === "review" && (
            <div className="space-y-2">
              {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("import.none")}</p>}
              {rows.map((r, i) => (
                <div key={i} className={cn("space-y-1.5 rounded-md border p-2", !r.keep && "opacity-50")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.keep}
                      onChange={(e) => update(i, { keep: e.target.checked })}
                      aria-label={t("import.keep", { name: r.name })}
                      className="h-4 w-4"
                    />
                    <Input
                      value={r.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                      className="h-8 flex-1 min-w-[10rem]"
                      aria-label={t("import.name")}
                    />
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={5}
                        step={5}
                        value={r.durationMinutes}
                        onChange={(e) => update(i, { durationMinutes: Number(e.target.value), durationSuggested: false })}
                        className="h-8 w-20"
                        aria-label={t("import.minutes")}
                      />
                      <span className="text-xs text-muted-foreground">{t("import.min")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">£</span>
                      <Input
                        inputMode="decimal"
                        placeholder="—"
                        defaultValue={minorToInput(r.priceMinor)}
                        onBlur={(e) => update(i, { priceMinor: parseMoney(e.target.value) })}
                        className="h-8 w-20"
                        aria-label={t("import.price")}
                      />
                    </div>
                  </div>
                  {(r.priceMinor === null || r.durationSuggested || r.existing || r.priceIsFrom || r.mightNeedSkinTest || r.note) && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-6">
                      {r.priceMinor === null && <span className={WARN}>{t("import.flagPrice")}</span>}
                      {r.durationSuggested && <span className={WARN}>{t("import.flagLength")}</span>}
                      {r.existing && <span className={FLAG}>{t("import.flagExisting")}</span>}
                      {r.priceIsFrom && <span className={FLAG}>{t("import.flagFrom")}</span>}
                      {r.mightNeedSkinTest && <span className={FLAG}>{t("import.flagSkinTest")}</span>}
                      {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                    </div>
                  )}
                </div>
              ))}
              {skipped.length > 0 && (
                <details className="rounded-md border px-2 py-1.5 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("import.skipped", { n: String(skipped.length) })}
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {skipped.map((s, i) => (
                      <li key={i}>
                        {s.text}
                        {s.reason && <span className="text-muted-foreground"> — {s.reason}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            {step === "review" ? (
              <>
                <Button type="button" variant="outline" onClick={reset}>
                  {t("import.again")}
                </Button>
                <Button type="button" onClick={apply} disabled={kept.length === 0}>
                  {t("import.add", { n: String(kept.length) })}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("import.cancel")}
                </Button>
                <Button type="button" onClick={read} disabled={files.length === 0 || step === "reading"}>
                  {t("import.read")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A photo as a JPEG no longer than MAX_SIDE on its long side; anything else
 * as it is. Null if the browser cannot open the photo at all.
 */
async function shrink(file: File): Promise<File | null> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob) return null;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return null;
  }
}
