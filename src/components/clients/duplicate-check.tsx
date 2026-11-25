"use client";

/**
 * "Is this Ann Lee?": a client card made from typed details another client
 * already has (src/lib/client-identity.ts), and the salon's answer.
 *
 * On a wide screen the two cards sit side by side under the question: pick
 * which to keep, then merge (after a list of what moves), or say they are
 * not the same person. On a phone or an upright tablet the question has two
 * buttons, and merging opens a sheet from the bottom with the same choice.
 * The work is the server's (src/lib/client-merge.ts).
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, PHONE_SHEET } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { useT } from "@/components/providers/language-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { INTL_LOCALE, type Lang, type Translate } from "@/lib/i18n";
import type { VisitSummaryJson } from "@/lib/client-summary";
import { cn } from "@/lib/utils";
import { speakablePhone } from "@/lib/phone";

/** One side of the comparison. */
export interface DupCard {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  summary: VisitSummaryJson | null;
}

interface Match {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

function shortDay(iso: string, lang: Lang, timeZone: string): string {
  return new Date(iso).toLocaleDateString(INTL_LOCALE[lang], { day: "numeric", month: "short", timeZone });
}

function facts(c: DupCard, t: Translate, lang: Lang, timeZone: string, withSource: boolean) {
  const s = c.summary;
  return [
    [t("dup.number"), c.phone ? speakablePhone(c.phone) : null],
    [t("dup.email"), c.email],
    [t("dup.visits"), s && s.visits > 0 ? (s.lastVisit ? t("dup.visitsLast", { n: s.visits, date: shortDay(s.lastVisit, lang, timeZone) }) : String(s.visits)) : null],
    [t("dup.booked"), s?.next ? `${shortDay(s.next.startsAt, lang, timeZone)} · ${s.next.service}` : null],
    ...(withSource && c.source ? [[t("dup.cameFrom"), SOURCES.has(c.source) ? t(`dup.source.${c.source}` as Parameters<Translate>[0]) : c.source]] : []),
  ] as Array<[string, string | null]>;
}

const SOURCES = new Set(["website", "instagram", "facebook", "phone", "whatsapp", "manual"]);

export function DuplicateCheck({
  client,
  match,
  timeZone,
  onMerged,
  onCleared,
}: {
  /** The flagged card, as the profile has it. */
  client: DupCard;
  /** The client it may be. */
  match: Match;
  timeZone: string;
  /** Merged: the card kept (open it). */
  onMerged: (keptId: string, keptName: string) => void;
  /** Not the same person: the mark is off. */
  onCleared: () => void;
}) {
  const { t, lang } = useT();
  const { notify } = useDialogs();
  const [other, setOther] = useState<DupCard | null>(null);
  const [keep, setKeep] = useState<"match" | "this">("match");
  const [step, setStep] = useState<"ask" | "confirm">("ask");
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch(`/api/clients/${match.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { client: DupCard; summary: VisitSummaryJson }) => {
        if (live) setOther({ ...d.client, summary: d.summary });
      })
      .catch(() => live && setOther({ ...match, source: null, summary: null }));
    return () => {
      live = false;
    };
  }, [match.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the same client, however often the profile re-renders

  const name = client.name ?? t("client.client");
  const matchName = match.name ?? t("client.anotherClient");
  const keepName = keep === "match" ? matchName : name;
  const goneName = keep === "match" ? name : matchName;
  const samePhone = Boolean(client.phone && client.phone === match.phone);
  const why = samePhone ? t("dup.whyPhone", { name, match: matchName }) : t("dup.whyEmail", { name, match: matchName });

  async function merge() {
    setBusy(true);
    try {
      const [from, into] = keep === "match" ? [client.id, match.id] : [match.id, client.id];
      const res = await apiFetch(`/api/clients/${from}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ into }),
      });
      if (!res.ok) throw new Error();
      setSheet(false);
      notify(t("dup.merged", { name: keepName }), "success");
      onMerged(into, keepName);
    } catch {
      notify(t("dup.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function notSame() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/clients/${client.id}/duplicate`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      notify(t("dup.kept"), "success");
      onCleared();
    } catch {
      notify(t("dup.failed"));
    } finally {
      setBusy(false);
    }
  }

  const choose = (
    <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label={t("dup.keepThis")}>
      {(["match", "this"] as const).map((side) => {
        const card = side === "match" ? (other ?? { ...match, source: null, summary: null }) : client;
        const on = keep === side;
        return (
          <button
            key={side}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setKeep(side)}
            className={cn(
              "flex flex-col gap-1.5 rounded-2xl border-2 bg-card p-3.5 text-left transition-colors",
              on ? "border-primary bg-muted" : "border-border hover:bg-muted/60"
            )}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full border-2", on ? "border-primary" : "border-tea-green-600")}>
                <span className={cn("h-2 w-2 rounded-full", on && "bg-primary")} />
              </span>
              <span className="text-xs font-bold uppercase tracking-[0.04em] text-muted-foreground">
                {on ? t("dup.keepThis") : side === "match" ? t("dup.onFile") : t("dup.flagged")}
              </span>
            </span>
            <span className="font-heading text-base font-extrabold">{side === "match" ? matchName : name}</span>
            {facts(card, t, lang, timeZone, side === "this").map(([k, v]) => (
              <span key={k} className="flex gap-2 text-[13px]">
                <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
                <span className={cn("min-w-0 [overflow-wrap:anywhere] font-semibold", !v && "font-normal text-muted-foreground")}>{v ?? t("dup.none")}</span>
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );

  const moves = (
    <ul className="list-disc space-y-1 pl-5 text-[13.5px]">
      <li>{t("dup.moves", { gone: goneName, keep: keepName })}</li>
      <li>{t("dup.keeps", { gone: goneName, keep: keepName })}</li>
      <li>{t("dup.goes", { gone: goneName })}</li>
    </ul>
  );

  return (
    <section aria-labelledby="dup-title" className="rounded-2xl border border-cornsilk-500 bg-cornsilk-900 px-4 py-3.5">
      <h3 id="dup-title" className="text-[15px] font-bold">
        {t("dup.title", { name: matchName })}
      </h3>
      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{why}</p>

      {/* Phone and upright tablet: two buttons, and a sheet to merge. */}
      <div className="mt-3 grid grid-cols-2 gap-2 lg:hidden">
        <Button className="h-11" disabled={busy} onClick={() => setSheet(true)}>
          {t("dup.same")}
        </Button>
        <Button className="h-11" variant="outline" disabled={busy} onClick={() => void notSame()}>
          {t("dup.notSame")}
        </Button>
      </div>

      {/* Wide screen: the two cards side by side, then merge or not. */}
      <div className="mt-3 hidden lg:block">
        {choose}
        {step === "ask" ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => setStep("confirm")}>
                {t("dup.sameMerge", { name: keepName })}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void notSame()}>
                {t("dup.notSame")}
              </Button>
            </div>
            <p className="mt-2 text-[12.5px] text-muted-foreground">{t("dup.unsure", { name: matchName })}</p>
          </>
        ) : (
          <div className="mt-3 rounded-2xl border border-border bg-card px-4 py-3">
            <p className="text-sm font-bold">{t("dup.confirmTitle", { name: keepName })}</p>
            <div className="mt-2">{moves}</div>
            <div className="mt-3 flex gap-2">
              <Button disabled={busy} onClick={() => void merge()}>
                {t("dup.merge")}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setStep("ask")}>
                {t("common.back")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={sheet} onOpenChange={setSheet}>
        <DialogContent className={cn("sm:max-w-lg", PHONE_SHEET)}>
          <DialogTitle className="font-heading text-lg font-extrabold">{t("dup.confirmTitle", { name: keepName })}</DialogTitle>
          <DialogDescription>{t("dup.unsure", { name: matchName })}</DialogDescription>
          {choose}
          {moves}
          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
            <Button variant="outline" className="h-12" disabled={busy} onClick={() => setSheet(false)}>
              {t("common.back")}
            </Button>
            <Button className="h-12" disabled={busy} onClick={() => void merge()}>
              {t("dup.merge")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
