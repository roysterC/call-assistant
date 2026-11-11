"use client";

/**
 * Setting the salon up, the first time its owner signs in (src/lib/onboarding.ts
 * has the steps and their rules). One thing at a time, each saved on Next, so
 * someone who closes the tab comes back to where they were. Uses the same
 * editors as Settings, and saves through the same API, so nothing here can
 * set the salon up differently from Settings. In English or Vietnamese, with
 * the flags in the header to switch.
 *
 * Finishing shows what to do next: the diary, Kikai on their phone, their
 * team's logins, and (if it is not on yet) that Kikai will be in touch about
 * the phone line.
 *
 * Staff who sign in first are told the salon is still being set up.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Check, Loader2, Pencil, PhoneCall, Smartphone, UserPlus, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark } from "@/components/dashboard/sidebar";
import { BusinessTypePicker } from "@/components/admin/business-type-picker";
import { OpeningHoursEditor } from "@/components/settings/opening-hours-editor";
import { ServicesEditor } from "@/components/settings/services-editor";
import { ServicesImport } from "@/components/settings/services-import";
import { StylistsEditor } from "@/components/settings/stylists-editor";
import { LanguageFlags } from "@/components/i18n/language-flags";
import { ME_CHANGED } from "@/components/providers/me-provider";
import { useLanguage, useT } from "@/components/providers/language-provider";
import { PROFILES, type BusinessType } from "@/lib/business-types";
import { toMinutes, type DayHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";
import { SALON_FAQ_MAX } from "@/lib/salon-knowledge";
import { minutesTime, type MessageKey } from "@/lib/i18n";
import {
  hasTypicalLength,
  resumeAt,
  stepProblem,
  stepsFor,
  type OnboardingStep,
} from "@/lib/onboarding";

interface Draft {
  businessName: string;
  contactPhone: string;
  businessHours: DayHours[];
  services: SalonService[];
  teamMembers: Stylist[];
  salonFaq: string;
}

/** A week to start from, rather than seven closed days: Monday to Saturday, nine till half five. */
const STARTER_WEEK: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) =>
  day === 0 ? { day, closed: true, open: "", close: "" } : { day, closed: false, open: "09:00", close: "17:30" }
);

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useT();
  const { clock } = useLanguage();
  const [loaded, setLoaded] = useState<"loading" | "owner" | "staff" | "failed">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [types, setTypes] = useState<{ main: BusinessType; also: BusinessType[] }>({ main: "hair", also: [] });
  const [answersCustomers, setAnswersCustomers] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [step, setStep] = useState<OnboardingStep>("salon");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const steps = useMemo(() => stepsFor(answersCustomers), [answersCustomers]);
  const at = steps.indexOf(step);
  const allTypes = useMemo(() => [types.main, ...types.also], [types]);
  const skinTests = allTypes.some((ty) => PROFILES[ty].skinTestFor.length > 0);

  useEffect(() => {
    let live = true;
    Promise.all([apiFetch("/api/onboarding").then((r) => r.json()), apiFetch("/api/settings").then((r) => r.json())])
      .then(([o, s]) => {
        if (!live) return;
        if (!o.needsOnboarding) {
          router.replace("/start");
          return;
        }
        if (!o.isOwner) {
          setLoaded("staff");
          return;
        }
        const st = s.settings ?? {};
        const d: Draft = {
          businessName: st.businessName || o.name || "",
          contactPhone: st.contactPhone ?? "",
          businessHours: st.businessHours?.length ? st.businessHours : STARTER_WEEK,
          services: st.services ?? [],
          teamMembers: st.teamMembers ?? [],
          salonFaq: st.salonFaq ?? "",
        };
        const answers = Boolean(
          st.voiceEnabled || st.chatbotEnabled || st.whatsappEnabled || st.instagramEnabled || st.facebookEnabled
        );
        setDraft(d);
        setTypes({ main: o.businessType, also: o.alsoOffers ?? [] });
        setAnswersCustomers(answers);
        setOwnerName(o.ownerName);
        setVoiceEnabled(Boolean(o.voiceEnabled));
        // Back where they left off: the furthest step they reached, but never
        // past one still to do. A first visit starts at the name.
        const own = stepsFor(answers);
        const reached = own.includes(o.step) ? (o.step as OnboardingStep) : null;
        const firstGap = resumeAt(own, { ...d, businessHours: st.businessHours ?? [] });
        setStep(
          !reached ? "salon" : own.indexOf(firstGap) < own.indexOf(reached) ? firstGap : reached
        );
        setLoaded("owner");
      })
      .catch(() => live && setLoaded("failed"));
    return () => {
      live = false;
    };
  }, [router]);

  function go(next: OnboardingStep) {
    setProblem(null);
    setStep(next);
    document.getElementById("onboarding-top")?.scrollIntoView({ block: "start" });
  }

  async function put(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    const res = await apiFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setProblem(data.error || t("onb.err.save"));
      return null;
    }
    return data;
  }

  /** Save this step; whether it worked. */
  async function save(d: Draft): Promise<boolean> {
    switch (step) {
      case "salon": {
        const r = await put("/api/onboarding", { name: d.businessName, businessType: types.main, alsoOffers: types.also });
        if (!r) return false;
        if (Array.isArray(r.services)) setDraft({ ...d, services: r.services as SalonService[] });
        // The CRM's own words for the team ("Add nail technician") follow the type.
        window.dispatchEvent(new Event(ME_CHANGED));
        return true;
      }
      case "hours":
        return Boolean(
          await put("/api/settings", {
            businessHours: d.businessHours,
            ...(d.contactPhone.trim() ? { contactPhone: d.contactPhone } : {}),
          })
        );
      case "services":
        return Boolean(await put("/api/settings", { services: d.services.filter((s) => s.name.trim()) }));
      case "team":
        return Boolean(await put("/api/settings", { teamMembers: d.teamMembers.filter((m) => m.name.trim()) }));
      case "about":
        return Boolean(await put("/api/settings", { salonFaq: d.salonFaq }));
      case "ready":
        return true;
    }
  }

  async function next() {
    if (!draft) return;
    const wrong = stepProblem(step, draft);
    if (wrong) {
      setProblem(t(`onb.err.${wrong}` as MessageKey));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (step === "ready") {
        const res = await apiFetch("/api/onboarding", { method: "POST" });
        if (!res.ok) {
          setProblem(t("onb.err.notReady"));
          return;
        }
        setDone(true);
        document.getElementById("onboarding-top")?.scrollIntoView({ block: "start" });
        return;
      }
      if (await save(draft)) {
        const following = steps[at + 1];
        // Where they have got to, for Kikai and for coming back: best effort.
        void apiFetch("/api/onboarding", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reached: following }),
        }).catch(() => {});
        go(following);
      }
    } catch {
      setProblem(t("common.offline"));
    } finally {
      setBusy(false);
    }
  }

  if (loaded === "loading" || (loaded === "owner" && !draft)) {
    return (
      <Shell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
        </div>
      </Shell>
    );
  }

  if (loaded === "failed" || loaded === "staff") {
    return (
      <Shell>
        <div className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
          <h1 className="font-heading text-2xl font-semibold">
            {loaded === "staff" ? t("onb.staffTitle") : t("inv.broken")}
          </h1>
          <p className="text-sm text-muted-foreground">{loaded === "staff" ? t("onb.staffBody") : t("onb.loadFailed")}</p>
        </div>
      </Shell>
    );
  }

  const d = draft!;
  const set = (patch: Partial<Draft>) => {
    setProblem(null);
    setDraft({ ...d, ...patch });
  };

  if (done) return <Finished salon={d.businessName} voiceEnabled={voiceEnabled} />;

  const openDays = d.businessHours.filter((h) => !h.closed).sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7));
  const named = d.services.filter((s) => s.name.trim());
  const time = (hhmm: string) => minutesTime(toMinutes(hhmm), clock);
  const weekSummary = () => {
    const runs: { from: DayHours; to: DayHours }[] = [];
    for (const h of openDays) {
      const last = runs[runs.length - 1];
      if (last && (last.to.day + 1) % 7 === h.day && last.to.open === h.open && last.to.close === h.close) last.to = h;
      else runs.push({ from: h, to: h });
    }
    const short = (x: DayHours) => t(`dayShort.${x.day}` as MessageKey);
    return runs
      .map(({ from, to }) => `${short(from)}${from === to ? "" : `–${short(to)}`} ${time(from.open)}–${time(from.close)}`)
      .join(", ");
  };
  const meInTeam = ownerName
    ? d.teamMembers.some((m) => m.name.trim().toLowerCase() === ownerName.trim().toLowerCase())
    : true;

  return (
    <Shell>
      <div id="onboarding-top" className="mx-auto w-full max-w-2xl px-4 pb-32 pt-6 md:pt-10">
        <ol className="mb-6 flex gap-1.5" aria-label={t("onb.step", { n: at + 1, total: steps.length })}>
          {steps.map((s, i) => (
            <li
              key={s}
              className={cn("h-1.5 flex-1 rounded-full", i <= at ? "bg-primary" : "bg-muted")}
              aria-current={s === step ? "step" : undefined}
            />
          ))}
        </ol>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("onb.step", { n: at + 1, total: steps.length })}
        </p>
        <h1 className="mt-1 font-heading text-2xl font-semibold">{t(`onb.${step}.title` as MessageKey)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(`onb.${step}.hint` as MessageKey)}</p>

        <div className="mt-6 space-y-5">
          {step === "salon" && (
            <>
              <div>
                <label htmlFor="salon-name" className="text-sm font-medium">{t("onb.salonName")}</label>
                <Input
                  id="salon-name"
                  value={d.businessName}
                  onChange={(e) => set({ businessName: e.target.value })}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <BusinessTypePicker
                audience="owner"
                main={types.main}
                also={types.also}
                onChange={(main, also) => {
                  setProblem(null);
                  setTypes({ main, also });
                }}
              />
            </>
          )}

          {step === "hours" && (
            <>
              <p className="rounded-xl border border-light-bronze-300 bg-light-bronze-900/40 px-4 py-3 text-sm" data-testid="hours-prompt">
                {t("onb.hoursPrompt")}
              </p>
              <OpeningHoursEditor value={d.businessHours} onChange={(businessHours) => set({ businessHours })} />
              <div>
                <label htmlFor="contact" className="text-sm font-medium">{t("onb.phone")}</label>
                <Input
                  id="contact"
                  value={d.contactPhone}
                  placeholder="01234 567890"
                  onChange={(e) => set({ contactPhone: e.target.value })}
                  className="mt-1"
                  inputMode="tel"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("onb.phoneHint")}</p>
              </div>
            </>
          )}

          {step === "services" && (
            <>
              {/* The quickest way through: a photo of the price list. */}
              <div className="rounded-2xl border bg-card p-4 sm:p-5" data-testid="price-list-photo">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tea-green-900 text-tea-green-200">
                    <Camera className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="font-medium">{t("onb.photoTitle")}</p>
                      <p className="text-sm text-muted-foreground">{t("onb.photoIntro")}</p>
                    </div>
                    <ServicesImport services={d.services} onApply={(services) => set({ services })} />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("onb.orTypical")}</p>
                <p className="text-xs text-muted-foreground">{t("onb.checkTimes")}</p>
              </div>
              <ServicesEditor
                value={d.services}
                onChange={(services) => set({ services })}
                skinTests={skinTests}
                typical={(s) => hasTypicalLength(s, allTypes)}
              />
            </>
          )}

          {step === "team" && (
            <>
              {!meInTeam && ownerName && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4" data-testid="add-me">
                  <Users className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="min-w-0 flex-1 text-sm font-medium">{t("onb.addMeQ")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      set({ teamMembers: [{ name: ownerName, role: "", workingDays: [], services: [] }, ...d.teamMembers] })
                    }
                  >
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    {t("onb.addMe", { name: ownerName })}
                  </Button>
                </div>
              )}
              <StylistsEditor
                value={d.teamMembers}
                services={d.services}
                businessHours={d.businessHours}
                trade={types.main}
                onChange={(teamMembers) => set({ teamMembers })}
              />
            </>
          )}

          {step === "about" && (
            <div className="space-y-2">
              <Textarea
                aria-label={t("onb.aboutLabel")}
                value={d.salonFaq}
                maxLength={SALON_FAQ_MAX}
                rows={8}
                placeholder={t("onb.aboutPlaceholder")}
                onChange={(e) => set({ salonFaq: e.target.value })}
                className="min-h-40"
              />
              <p className="text-xs text-muted-foreground">{t("onb.aboutHint")}</p>
            </div>
          )}

          {step === "ready" && (
            <ul className="divide-y divide-border rounded-xl border bg-card">
              {(
                [
                  [
                    "salon",
                    d.businessName,
                    allTypes.map((ty) => t(`type.${ty}` as MessageKey)).join(", "),
                  ],
                  [
                    "hours",
                    openDays.length === 0
                      ? t("onb.closedAll")
                      : openDays.length === 1
                        ? t("onb.openDay1")
                        : t("onb.openDays", { n: openDays.length }),
                    weekSummary(),
                  ],
                  [
                    "services",
                    named.length === 1 ? t("onb.servicesCount1") : t("onb.servicesCount", { n: named.length }),
                    named.map((s) => s.name).slice(0, 4).join(", "),
                  ],
                  [
                    "team",
                    d.teamMembers.length === 1 ? t("onb.teamCount1") : t("onb.teamCount", { n: d.teamMembers.length }),
                    d.teamMembers.map((m) => m.name).join(", "),
                  ],
                  ...(answersCustomers
                    ? [
                        [
                          "about",
                          t("onb.about.title"),
                          d.salonFaq.trim()
                            ? t("onb.lines", { n: d.salonFaq.split("\n").filter((l) => l.trim()).length })
                            : t("onb.nothingYet"),
                        ],
                      ]
                    : []),
                ] as [OnboardingStep, string, string][]
              ).map(([s, head, detail]) => (
                <li key={s} className="flex items-center gap-3 px-4 py-3">
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{head}</p>
                    {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => go(s)}
                    aria-label={`${t("onb.change")}: ${t(`onb.${s}.title` as MessageKey)}`}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {t("onb.change")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Always in reach, however long the step: on a phone, under a thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {at > 0 ? (
            <Button variant="outline" onClick={() => go(steps[at - 1])} disabled={busy}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("common.back")}
            </Button>
          ) : (
            <span />
          )}
          <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
            {problem}
          </p>
          {step === "about" && !d.salonFaq.trim() ? (
            <Button variant="ghost" onClick={() => go(steps[at + 1])} disabled={busy}>
              {t("onb.skip")}
            </Button>
          ) : null}
          <Button onClick={next} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {step === "ready" ? t("onb.finish") : t("onb.next")}
            {step !== "ready" && !busy && <ArrowRight className="ml-1.5 h-4 w-4" />}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

/** After Finish: what to do next, so the end of setting up is a beginning. */
function Finished({ salon, voiceEnabled }: { salon: string; voiceEnabled: boolean }) {
  const { t } = useT();
  const items: { icon: typeof CalendarDays; title: string; body: React.ReactNode; action?: React.ReactNode }[] = [
    {
      icon: CalendarDays,
      title: t("done.diary"),
      body: t("done.diaryHint"),
      action: (
        <Link href="/calendar" className={buttonVariants()}>
          {t("done.diary")}
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      ),
    },
    {
      icon: Smartphone,
      title: t("done.phone"),
      body: (
        <>
          <span className="block">{t("done.phoneIos")}</span>
          <span className="block">{t("done.phoneAndroid")}</span>
        </>
      ),
    },
    {
      icon: Users,
      title: t("done.team"),
      body: t("done.teamHint"),
      action: (
        <Link href="/settings#team-logins" className={buttonVariants({ variant: "outline" })}>
          {t("done.team")}
        </Link>
      ),
    },
    ...(voiceEnabled ? [] : [{ icon: PhoneCall, title: t("done.line"), body: t("done.lineHint") }]),
  ];
  return (
    <Shell>
      <div id="onboarding-top" className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 md:pt-10" data-testid="onboarding-done">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tea-green-900 text-tea-green-200">
          <Check className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 font-heading text-2xl font-semibold">{t("done.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("done.intro", { salon })}</p>
        <ul className="mt-6 space-y-3">
          {items.map(({ icon: Icon, title, body, action }) => (
            <li key={title} className="flex flex-wrap items-start gap-3 rounded-2xl border bg-card p-4">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{body}</p>
              </div>
              {action}
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          <BrandMark size="sm" alt="" />
          <span className="flex-1 font-heading font-semibold">Kikai</span>
          <LanguageFlags />
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            {t("onb.signOut")}
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}
