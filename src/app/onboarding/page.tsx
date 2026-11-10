"use client";

/**
 * Setting the salon up, the first time its owner signs in (src/lib/onboarding.ts
 * has the steps and their rules). One thing at a time, each saved on Next, so
 * someone who closes the tab comes back to where they were. Uses the same
 * editors as Settings, and saves through the same API, so nothing here can
 * set the salon up differently from Settings.
 *
 * Staff who sign in first are told the salon is still being set up.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ArrowLeft, ArrowRight, Check, Loader2, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark } from "@/components/dashboard/sidebar";
import { BusinessTypePicker } from "@/components/admin/business-type-picker";
import { OpeningHoursEditor } from "@/components/settings/opening-hours-editor";
import { ServicesEditor } from "@/components/settings/services-editor";
import { ServicesImport } from "@/components/settings/services-import";
import { StylistsEditor } from "@/components/settings/stylists-editor";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { ME_CHANGED } from "@/components/providers/me-provider";
import { PROFILES, inTradeWords, type BusinessType } from "@/lib/business-types";
import type { DayHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";
import { SALON_FAQ_MAX } from "@/lib/salon-knowledge";
import { plural } from "@/lib/plural";
import { resumeAt, stepProblem, stepsFor, type OnboardingStep } from "@/lib/onboarding";

interface Draft {
  businessName: string;
  contactPhone: string;
  businessHours: DayHours[];
  services: SalonService[];
  teamMembers: Stylist[];
  salonFaq: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A week to start from, rather than seven closed days: Monday to Saturday, nine till half five. */
const STARTER_WEEK: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) =>
  day === 0 ? { day, closed: true, open: "", close: "" } : { day, closed: false, open: "09:00", close: "17:30" }
);

const TITLES: Record<OnboardingStep, { title: string; hint: string }> = {
  salon: { title: "Your salon", hint: "Its name, as clients know it, and what you do." },
  hours: { title: "Opening hours", hint: "When clients can book. The receptionist tells callers these too." },
  services: {
    title: "Your services",
    hint: "What you offer and how long each takes. The time decides how much of the diary a booking fills.",
  },
  team: { title: "Your team", hint: "Who can be booked, the days they work and what they do." },
  about: {
    title: "About the salon",
    hint: "What the receptionist and chats can tell customers who ask. You can add to it later in Settings.",
  },
  ready: { title: "All set?", hint: "A last look before you start." },
};

export default function OnboardingPage() {
  const router = useRouter();
  const { notify } = useDialogs();
  const [loaded, setLoaded] = useState<"loading" | "owner" | "staff">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [types, setTypes] = useState<{ main: BusinessType; also: BusinessType[] }>({ main: "hair", also: [] });
  const [staff, setStaff] = useState("stylist");
  const [answersCustomers, setAnswersCustomers] = useState(false);
  const [step, setStep] = useState<OnboardingStep>("salon");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const steps = useMemo(() => stepsFor(answersCustomers), [answersCustomers]);
  const at = steps.indexOf(step);
  const w = (text: string) => inTradeWords(text, { staff });

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
        setStaff(o.staff || "stylist");
        setAnswersCustomers(answers);
        // Back where they left off. The name is always asked first, so a
        // salon named by Kikai still has its owner look at it.
        const resume = resumeAt(stepsFor(answers), { ...d, businessHours: st.businessHours ?? [] }, o.staff);
        setStep(st.businessHours?.length ? resume : "salon");
        setLoaded("owner");
      })
      .catch(() => notify("Couldn't load your salon. Check your connection and reload the page."));
    return () => {
      live = false;
    };
  }, [router, notify]);

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
      setProblem(data.error || "Couldn't save. Try again.");
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
        if (typeof r.staff === "string") setStaff(r.staff);
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
    const wrong = stepProblem(step, draft, staff);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (step === "ready") {
        const res = await apiFetch("/api/onboarding", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setProblem(data.error || "Couldn't finish. Try again.");
          return;
        }
        notify("Your salon is set up", "success");
        router.replace("/start");
        return;
      }
      if (await save(draft)) go(steps[at + 1]);
    } catch {
      setProblem("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loaded === "loading" || (loaded === "owner" && !draft)) {
    return (
      <Shell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </Shell>
    );
  }

  if (loaded === "staff") {
    return (
      <Shell>
        <div className="mx-auto max-w-md space-y-3 py-16 text-center">
          <h1 className="font-heading text-2xl font-semibold">Your salon is being set up</h1>
          <p className="text-sm text-muted-foreground">
            The owner is putting in the salon&apos;s hours, services and team. You&apos;ll be able to use Kikai as soon
            as they finish.
          </p>
        </div>
      </Shell>
    );
  }

  const d = draft!;
  const set = (patch: Partial<Draft>) => {
    setProblem(null);
    setDraft({ ...d, ...patch });
  };
  const openDays = d.businessHours.filter((h) => !h.closed).sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7));
  const { title, hint } = TITLES[step];

  return (
    <Shell>
      <div id="onboarding-top" className="mx-auto w-full max-w-2xl px-4 pb-32 pt-6 md:pt-10">
        <ol className="mb-6 flex gap-1.5" aria-label={`Step ${at + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <li
              key={s}
              className={cn("h-1.5 flex-1 rounded-full", i <= at ? "bg-primary" : "bg-muted")}
              aria-current={s === step ? "step" : undefined}
            />
          ))}
        </ol>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {at + 1} of {steps.length}
        </p>
        <h1 className="mt-1 font-heading text-2xl font-semibold">{w(title)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{w(hint)}</p>

        <div className="mt-6 space-y-5">
          {step === "salon" && (
            <>
              <div>
                <label htmlFor="salon-name" className="text-sm font-medium">Salon name</label>
                <Input
                  id="salon-name"
                  value={d.businessName}
                  onChange={(e) => set({ businessName: e.target.value })}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <BusinessTypePicker
                main={types.main}
                also={types.also}
                onChange={(main, also) => {
                  setProblem(null);
                  setTypes({ main, also });
                  setStaff(PROFILES[main].staff);
                }}
              />
            </>
          )}

          {step === "hours" && (
            <>
              <OpeningHoursEditor value={d.businessHours} onChange={(businessHours) => set({ businessHours })} />
              <div>
                <label htmlFor="contact" className="text-sm font-medium">Salon phone number</label>
                <Input
                  id="contact"
                  value={d.contactPhone}
                  placeholder="01234 567890"
                  onChange={(e) => set({ contactPhone: e.target.value })}
                  className="mt-1"
                  inputMode="tel"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Printed in booking texts, which clients can&apos;t reply to: it&apos;s how they reach you about a
                  booking.
                </p>
              </div>
            </>
          )}

          {step === "services" && (
            <>
              <ServicesImport services={d.services} onApply={(services) => set({ services })} />
              <ServicesEditor value={d.services} onChange={(services) => set({ services })} />
            </>
          )}

          {step === "team" && (
            <StylistsEditor
              value={d.teamMembers}
              services={d.services}
              businessHours={d.businessHours}
              onChange={(teamMembers) => set({ teamMembers })}
            />
          )}

          {step === "about" && (
            <div className="space-y-2">
              <Textarea
                aria-label="About the salon"
                value={d.salonFaq}
                maxLength={SALON_FAQ_MAX}
                rows={8}
                placeholder={
                  "Where are you? 47 Bridge Street, next to the florist.\n" +
                  "Parking? Six spaces behind the salon.\n" +
                  "Cancellations: please give 24 hours' notice.\n" +
                  "Gift vouchers: yes, any amount, from the desk."
                }
                onChange={(e) => set({ salonFaq: e.target.value })}
                className="min-h-40"
              />
              <p className="text-xs text-muted-foreground">
                A question and its answer per line is plenty. Skip it for now if you like.
              </p>
            </div>
          )}

          {step === "ready" && (
            <ul className="divide-y divide-border rounded-xl border bg-card">
              {(
                [
                  ["salon", d.businessName, [PROFILES[types.main].label, ...types.also.map((t) => PROFILES[t].label)].join(", ")],
                  [
                    "hours",
                    openDays.length ? `Open ${plural(openDays.length, "day")} a week` : "Closed every day",
                    weekSummary(openDays),
                  ],
                  ["services", plural(d.services.filter((s) => s.name.trim()).length, "service"), d.services.map((s) => s.name).filter(Boolean).slice(0, 4).join(", ")],
                  ["team", plural(d.teamMembers.length, staff), d.teamMembers.map((m) => m.name).join(", ")],
                  ...(answersCustomers
                    ? [["about", "About the salon", d.salonFaq.trim() ? plural(d.salonFaq.split("\n").filter((l) => l.trim()).length, "line") : "Nothing yet"]]
                    : []),
                ] as [OnboardingStep, string, string][]
              ).map(([s, head, detail]) => (
                <li key={s} className="flex items-center gap-3 px-4 py-3">
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{head}</p>
                    {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => go(s)} aria-label={`Change ${TITLES[s].title.toLowerCase()}`}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Change
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
              Back
            </Button>
          ) : (
            <span />
          )}
          <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
            {problem}
          </p>
          {step === "about" && !d.salonFaq.trim() ? (
            <Button variant="ghost" onClick={() => go(steps[at + 1])} disabled={busy}>
              Skip
            </Button>
          ) : null}
          <Button onClick={next} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {step === "ready" ? "Finish" : "Next"}
            {step !== "ready" && !busy && <ArrowRight className="ml-1.5 h-4 w-4" />}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

/**
 * "Mon–Sat 09:00–17:30", or "Mon–Fri 09:00–17:30, Sat 09:00–16:00": days in
 * a row with the same hours run together. `open` is the open days, Monday first.
 */
function weekSummary(open: DayHours[]): string {
  const runs: { from: DayHours; to: DayHours }[] = [];
  for (const h of open) {
    const last = runs[runs.length - 1];
    if (last && (last.to.day + 1) % 7 === h.day && last.to.open === h.open && last.to.close === h.close) last.to = h;
    else runs.push({ from: h, to: h });
  }
  const short = (d: DayHours) => DAY_NAMES[d.day].slice(0, 3);
  return runs
    .map(({ from, to }) => `${short(from)}${from === to ? "" : `–${short(to)}`} ${from.open}–${from.close}`)
    .join(", ");
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          <BrandMark size="sm" alt="" />
          <span className="flex-1 font-heading font-semibold">Kikai</span>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign out
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}
