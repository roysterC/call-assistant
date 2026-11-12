"use client";

/**
 * The online booking flow: service, time, name and mobile, booked.
 *
 * Built to ask as little as possible of someone on a phone. Choosing a
 * service or a time moves on by itself; who they see is a filter on the time
 * step ("Anyone" unless they pick); the only extra question is "had colour
 * here before?", and only for colour; name and mobile are filled in by the
 * phone and remembered for next time. A time that goes while they type is
 * answered with the nearest free ones, their details kept.
 *
 * Used on the salon's own site (/s/<slug>/book) and inside a salon's
 * existing website (/embed/book/<slug>, via public/book.js), where it tells
 * the page around it when a booking is made and how tall it is.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Calendar, Check, ChevronRight, Info, MapPin, Search, X } from "lucide-react";
import { formatMoneyShort } from "@/lib/money";
import type { PublicSalon, PublicService } from "@/lib/online-booking/catalogue";
import type { DaySlots, PublicSlot } from "@/lib/online-booking/slots";
import { brandStyle, durationText, periodOf, PERIODS, timeText, dayLabel, longDay, icsFor } from "./format";

type Step = "service" | "colour" | "time" | "details" | "done";
export type FlowMode = "page" | "popup" | "inline";

interface Booked {
  bookingNumber: number | null;
  start: string;
  service: string;
  stylist: string;
  name: string;
  textSent: boolean;
  skinTest: boolean;
}

const DETAILS_KEY = "kikai-book-details";

function readDetails(): { name: string; phone: string } {
  try {
    const v = JSON.parse(localStorage.getItem(DETAILS_KEY) ?? "null");
    if (v && typeof v.name === "string" && typeof v.phone === "string") return v;
  } catch {
    // Private browsing or blocked storage: the phone's autofill still helps.
  }
  return { name: "", phone: "" };
}

function saveDetails(d: { name: string; phone: string }) {
  try {
    localStorage.setItem(DETAILS_KEY, JSON.stringify(d));
  } catch {
    // As above.
  }
}

/** To the page around the embed, if there is one. */
function tellHost(message: Record<string, unknown>) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ source: "kikai-book", ...message }, "*");
}

export function BookingFlow({
  salon,
  takesBookings,
  mode = "page",
  initialService,
  initialStylist,
  initialStart,
  homeHref,
}: {
  salon: PublicSalon;
  takesBookings: boolean;
  mode?: FlowMode;
  initialService?: string | null;
  initialStylist?: string | null;
  /**
   * A time already chosen ("Next free" on the salon's site): the flow opens
   * on name and mobile. Not for colour, which must ask its question first.
   */
  initialStart?: string | null;
  /** Where "back" from the first step goes on the salon's own site. */
  homeHref?: string;
}) {
  const preset = useMemo(
    () => salon.services.find((s) => s.name.toLowerCase() === (initialService ?? "").toLowerCase()) ?? null,
    [salon.services, initialService]
  );
  const [service, setService] = useState<PublicService | null>(preset);
  const [newClient, setNewClient] = useState(false);
  const [stylist, setStylist] = useState<string | null>(
    preset && initialStylist && preset.stylists.some((s) => s.toLowerCase() === initialStylist.toLowerCase())
      ? preset.stylists.find((s) => s.toLowerCase() === initialStylist.toLowerCase())!
      : null
  );
  const presetSlot =
    preset && !preset.requiresPatchTest && initialStart && !Number.isNaN(Date.parse(initialStart))
      ? { start: new Date(initialStart).toISOString(), stylist: initialStylist ?? null }
      : null;
  const [slot, setSlot] = useState<PublicSlot | null>(presetSlot);
  const [step, setStepState] = useState<Step>(
    presetSlot ? "details" : preset ? (preset.requiresPatchTest ? "colour" : "time") : "service"
  );
  const [booked, setBooked] = useState<Booked | null>(null);

  // The browser's back button walks back through the steps. `depth` is how
  // many steps this flow has pushed, so "back" never leaves it by accident:
  // inside an embed that would take the salon's own page back a page.
  const depth = useRef(0);
  const isBooked = useRef(false);
  const setStep = useCallback((next: Step) => {
    setStepState(next);
    try {
      window.history.pushState({ kikaiStep: next }, "");
      depth.current += 1;
    } catch {
      // Some embeds refuse history; the on-screen back still works.
    }
    rootRef.current?.scrollTo?.({ top: 0 });
    window.scrollTo?.({ top: 0 });
  }, []);
  useEffect(() => {
    try {
      window.history.replaceState({ kikaiStep: step }, "");
    } catch {
      // As above.
    }
    const onPop = (e: PopStateEvent) => {
      depth.current = Math.max(0, depth.current - 1);
      // Once booked, going back must not bring the form up to book again.
      if (isBooked.current) return;
      const s = e.state?.kikaiStep as Step | undefined;
      if (s && s !== "done") setStepState(s);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // Once: the first entry is whatever step the flow opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An inline embed is as tall as what it shows, so the page around it grows.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "inline" || !rootRef.current) return;
    const el = rootRef.current;
    const report = () => tellHost({ type: "resize", height: Math.ceil(el.scrollHeight) });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const pickService = (s: PublicService) => {
    setService(s);
    setSlot(null);
    if (stylist && !s.stylists.includes(stylist)) setStylist(null);
    setStep(s.requiresPatchTest ? "colour" : "time");
  };

  const back = () => {
    if (step === "service") {
      if (mode === "popup") tellHost({ type: "close" });
      else if (homeHref) window.location.href = homeHref;
      return;
    }
    if (depth.current === 0) {
      // Opened part-way in: a "Book" link for one service goes back to the
      // list, a "Next free" time back to the other times.
      setStep(step === "details" ? "time" : "service");
      return;
    }
    window.history.back();
  };

  const stepNumber = step === "service" ? 1 : step === "colour" || step === "time" ? 2 : 3;

  const root =
    mode === "inline"
      ? "bg-white text-stone-900"
      : "h-dvh overflow-y-auto bg-white text-stone-900";

  return (
    <div ref={rootRef} className={root} style={brandStyle(salon.brandColor)}>
      <div className="mx-auto flex min-h-full max-w-xl flex-col">
        {step !== "done" && (
          <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-2 pb-3 pt-2 backdrop-blur">
            <div className="flex items-center gap-1">
              {step === "service" && mode === "inline" ? (
                <span className="w-11" />
              ) : (
                <button
                  type="button"
                  onClick={back}
                  aria-label={step === "service" ? (mode === "popup" ? "Close" : `Back to ${salon.name}`) : "Back"}
                  className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-stone-100"
                >
                  {step === "service" && mode === "popup" ? <X className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
                </button>
              )}
              <span className="flex-1 truncate font-semibold">{salon.name}</span>
              <span className="pr-3 text-sm text-stone-600">Step {stepNumber} of 3</span>
              {mode === "popup" && step !== "service" && (
                <button
                  type="button"
                  onClick={() => tellHost({ type: "close" })}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-stone-100"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 px-3" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className="h-1 rounded-full"
                  style={{ background: n <= stepNumber ? "var(--brand)" : "#e7e5e4" }}
                />
              ))}
            </div>
          </header>
        )}

        <main className="flex-1 px-4 pb-8 pt-5">
          {!takesBookings ? (
            <NotTaking salon={salon} />
          ) : step === "service" ? (
            <ServiceStep salon={salon} onPick={pickService} />
          ) : step === "colour" && service ? (
            <ColourStep
              service={service}
              onAnswer={(isNew) => {
                setNewClient(isNew);
                setSlot(null);
                setStep("time");
              }}
            />
          ) : step === "time" && service ? (
            <TimeStep
              salon={salon}
              service={service}
              newClient={newClient}
              stylist={stylist}
              onStylist={(s) => {
                setStylist(s);
                setSlot(null);
              }}
              onChangeService={() => setStep("service")}
              onPick={(s) => {
                setSlot(s);
                setStep("details");
              }}
            />
          ) : step === "details" && service && slot ? (
            <DetailsStep
              salon={salon}
              service={service}
              slot={slot}
              stylist={stylist}
              newClient={newClient}
              onSlot={setSlot}
              onChangeTime={back}
              onChangeService={() => setStep("service")}
              onBooked={(b) => {
                isBooked.current = true;
                setBooked(b);
                setStepState("done");
                rootRef.current?.scrollTo?.({ top: 0 });
                tellHost({
                  type: "booked",
                  bookingNumber: b.bookingNumber,
                  service: b.service,
                  start: b.start,
                });
              }}
            />
          ) : step === "done" && booked ? (
            <DoneStep
              salon={salon}
              booked={booked}
              onAgain={() => {
                isBooked.current = false;
                setBooked(null);
                setSlot(null);
                setService(null);
                setStep("service");
              }}
              onClose={mode === "popup" ? () => tellHost({ type: "close" }) : undefined}
            />
          ) : (
            <ServiceStep salon={salon} onPick={pickService} />
          )}
        </main>

        {mode !== "page" && (
          <footer className="px-4 pb-4 text-center text-xs text-stone-500">Online booking by Kikai</footer>
        )}
      </div>
    </div>
  );
}

function NotTaking({ salon }: { salon: PublicSalon }) {
  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 p-5">
      <h1 className="font-heading text-2xl font-extrabold tracking-tight">Online booking is not open just now</h1>
      {salon.phone ? (
        <p className="text-stone-700">
          Please ring us on{" "}
          <a className="font-semibold underline" href={`tel:${salon.phone}`}>
            {salon.phone}
          </a>{" "}
          to book.
        </p>
      ) : (
        <p className="text-stone-700">Please contact the salon to book.</p>
      )}
    </div>
  );
}

function ServiceStep({ salon, onPick }: { salon: PublicSalon; onPick: (s: PublicService) => void }) {
  const [q, setQ] = useState("");
  const shown = salon.services.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-[1.65rem] font-extrabold tracking-tight">What are you booking?</h1>
      {salon.services.length > 8 && (
        <label className="flex h-12 items-center gap-2.5 rounded-xl border border-stone-300 bg-stone-50 px-3.5">
          <Search className="h-4 w-4 text-stone-500" aria-hidden="true" />
          <span className="sr-only">Search services</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search services"
            className="h-full flex-1 bg-transparent text-base outline-none"
          />
        </label>
      )}
      <ul className="space-y-2">
        {shown.map((s) => (
          <li key={s.name}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-stone-200 px-4 py-3 text-left transition hover:border-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
            >
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-semibold">{s.name}</span>
                <span className="text-sm text-stone-600">
                  {durationText(s.durationMinutes)}
                  {s.requiresPatchTest ? " · skin test for new clients" : ""}
                </span>
              </span>
              {s.priceMinor !== null && <span className="font-semibold">{formatMoneyShort(s.priceMinor)}</span>}
              <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="text-stone-600">Nothing matches &ldquo;{q}&rdquo;.</p>}
      {salon.services.some((s) => s.priceMinor !== null) && (
        <p className="text-xs text-stone-500">Prices are a guide and can vary with hair length and thickness.</p>
      )}
    </div>
  );
}

function ColourStep({ service, onAnswer }: { service: PublicService; onAnswer: (isNew: boolean) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-stone-600">
          {service.name} · {durationText(service.durationMinutes)}
        </p>
        <h1 className="font-heading text-[1.65rem] font-extrabold tracking-tight">Had colour with us before?</h1>
      </div>
      <button
        type="button"
        onClick={() => onAnswer(false)}
        className="flex h-16 w-full items-center justify-between rounded-2xl border-2 px-5 text-lg font-semibold"
        style={{ borderColor: "var(--brand)" }}
      >
        Yes, I&rsquo;ve been before <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onAnswer(true)}
        className="flex h-16 w-full items-center justify-between rounded-2xl border-2 border-stone-300 px-5 text-lg font-semibold"
      >
        No, it&rsquo;s my first time <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
      <p className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-800" aria-hidden="true" />
        New colour clients need a quick skin test at the salon at least 48 hours before. We&rsquo;ll only show
        times that allow for it, and the salon will be in touch to arrange it.
      </p>
    </div>
  );
}

function TimeStep({
  salon,
  service,
  newClient,
  stylist,
  onStylist,
  onChangeService,
  onPick,
}: {
  salon: PublicSalon;
  service: PublicService;
  newClient: boolean;
  stylist: string | null;
  onStylist: (s: string | null) => void;
  onChangeService: () => void;
  onPick: (s: PublicSlot) => void;
}) {
  const [from, setFrom] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  // The answer for one question (service, stylist, week, new or not); it is
  // loading while the answer on hand is for a different one.
  const key = [service.name, stylist ?? "", from ?? "", newClient ? "new" : ""].join("|");
  const [result, setResult] = useState<{
    key: string;
    data?: { days: DaySlots[]; from: string; next: string | null };
    error?: string;
  } | null>(null);
  const loading = result?.key !== key;
  const data = result?.data ?? null;
  const error = !loading ? (result?.error ?? null) : null;

  useEffect(() => {
    let live = true;
    const p = new URLSearchParams({ service: service.name });
    if (stylist) p.set("stylist", stylist);
    if (from) p.set("from", from);
    if (newClient) p.set("newClient", "1");
    fetch(`/api/book/${salon.slug}/availability?${p}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Could not load times.");
        if (!live) return;
        // Open on the first day with space.
        const first = (body.days as DaySlots[]).find((d) => d.slots.length > 0);
        setDay(first?.date ?? body.days[0]?.date ?? null);
        setResult({ key, data: body });
      })
      .catch((e: Error) => {
        if (live) setResult({ key, data: result?.data, error: e.message || "Could not load times. Please try again." });
      });
    return () => {
      live = false;
    };
    // `result` is only read for the times already on screen when one fails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salon.slug, service.name, stylist, from, newClient, key]);

  const selected = data?.days.find((d) => d.date === day) ?? null;
  const noneThisWeek = data && data.days.every((d) => d.slots.length === 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl bg-stone-100 px-4 py-3">
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">{service.name}</span>
          <span className="text-sm text-stone-600">
            {durationText(service.durationMinutes)}
            {service.priceMinor !== null ? ` · ${formatMoneyShort(service.priceMinor)}` : ""}
          </span>
        </span>
        <button type="button" onClick={onChangeService} className="px-1 py-2.5 text-sm font-semibold text-[var(--brand-ink)]">
          Change
        </button>
      </div>

      <h1 className="font-heading text-[1.65rem] font-extrabold tracking-tight">When suits you?</h1>

      {salon.stylistChoice && service.stylists.length > 1 && (
        <div role="group" aria-label="Who with" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {[null, ...service.stylists].map((s) => {
            const on = stylist === s;
            return (
              <button
                key={s ?? "anyone"}
                type="button"
                aria-pressed={on}
                onClick={() => onStylist(s)}
                className={`h-10 shrink-0 rounded-full border px-4 text-sm font-semibold ${
                  on ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"
                }`}
              >
                {s ?? "Anyone"}
              </button>
            );
          })}
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded-2xl border border-orange-300 bg-orange-50 p-4 text-sm">
          {error}
        </p>
      ) : !data ? (
        <SlotsSkeleton />
      ) : (
        <>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                type="button"
                aria-label="Earlier days"
                onClick={() => {
                  const prev = history[history.length - 1];
                  setHistory(history.slice(0, -1));
                  setFrom(prev);
                }}
                className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-stone-100"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div role="group" aria-label="Day" className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 pb-1">
              {data.days.map((d) => {
                const on = d.date === day;
                const shut = d.slots.length === 0;
                return (
                  <button
                    key={d.date}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDay(d.date)}
                    className={`flex h-[4.75rem] w-[3.9rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border ${
                      on
                        ? "border-stone-900 bg-stone-900 text-white"
                        : shut
                          ? "border-stone-100 bg-stone-100 text-stone-500"
                          : "border-stone-300 bg-white"
                    }`}
                  >
                    <span className="text-xs font-medium">{dayLabel(d.date, salon.timeZone).dow}</span>
                    <span className="text-xl font-bold">{dayLabel(d.date, salon.timeZone).date}</span>
                    <span className="text-[0.7rem] font-medium">
                      {d.status === "closed" ? "Closed" : d.status === "full" ? "Full" : `${d.slots.length} free`}
                    </span>
                  </button>
                );
              })}
            </div>
            {data.next && (
              <button
                type="button"
                aria-label="Later days"
                onClick={() => {
                  setHistory([...history, data.from]);
                  setFrom(data.next);
                }}
                className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-stone-100"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>

          {loading ? (
            <SlotsSkeleton />
          ) : noneThisWeek ? (
            <div className="space-y-3 rounded-2xl border border-stone-200 p-4">
              <p className="font-semibold">Nothing free these days{stylist ? ` with ${stylist}` : ""}.</p>
              <div className="flex flex-wrap gap-2">
                {data.next && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistory([...history, data.from]);
                      setFrom(data.next);
                    }}
                    className="h-11 rounded-full border border-stone-300 px-4 text-sm font-semibold"
                  >
                    Try the next week
                  </button>
                )}
                {stylist && (
                  <button
                    type="button"
                    onClick={() => onStylist(null)}
                    className="h-11 rounded-full border border-stone-300 px-4 text-sm font-semibold"
                  >
                    Anyone available
                  </button>
                )}
              </div>
            </div>
          ) : selected && selected.slots.length > 0 ? (
            <section className="space-y-4">
              <h2 className="font-semibold">{longDay(selected.date, salon.timeZone)}</h2>
              {PERIODS.map((period) => {
                const slots = selected.slots.filter((s) => periodOf(s.start, salon.timeZone) === period);
                if (slots.length === 0) return null;
                return (
                  <div key={period} className="space-y-2">
                    <h3 className="text-sm text-stone-600">{period}</h3>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {slots.map((s) => (
                        <button
                          key={s.start}
                          type="button"
                          onClick={() => onPick(s)}
                          className="h-12 rounded-xl border border-stone-300 text-base font-semibold hover:border-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                        >
                          {timeText(s.start, salon.timeZone)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <p className="text-sm text-stone-600">Tap a time to continue.</p>
            </section>
          ) : selected ? (
            <p className="rounded-2xl bg-stone-100 p-4 text-stone-700">
              {selected.status === "closed" ? "We're closed that day." : "That day is fully booked."} Pick another day.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function SlotsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2" aria-busy="true" aria-label="Loading times">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="h-12 animate-pulse rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}

function DetailsStep({
  salon,
  service,
  slot,
  stylist,
  newClient,
  onSlot,
  onChangeTime,
  onChangeService,
  onBooked,
}: {
  salon: PublicSalon;
  service: PublicService;
  slot: PublicSlot;
  stylist: string | null;
  newClient: boolean;
  onSlot: (s: PublicSlot) => void;
  onChangeTime: () => void;
  onChangeService: () => void;
  onBooked: (b: Booked) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [company, setCompany] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ code: string; error: string; alternatives?: PublicSlot[] } | null>(null);

  // Remembered from their last booking on this browser.
  useEffect(() => {
    const d = readDetails();
    if (d.name) setName((n) => n || d.name);
    if (d.phone) setPhone((p) => p || d.phone);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/book/${salon.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: service.name,
          start: slot.start,
          stylist: stylist ?? slot.stylist,
          name,
          phone,
          newClient,
          notes,
          company,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        saveDetails({ name, phone });
        onBooked(body as Booked);
        return;
      }
      setProblem({
        code: body.code ?? "failed",
        error: body.error ?? "Sorry, that could not be booked. Please try again.",
        alternatives: body.alternatives,
      });
    } catch {
      setProblem({ code: "failed", error: "Could not reach the salon. Check your connection and try again." });
    } finally {
      setSending(false);
    }
  };

  const who = stylist ?? slot.stylist;
  const timeGone = problem && (problem.code === "taken" || problem.code === "too_soon");

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {timeGone ? (
        <div role="alert" className="space-y-3 rounded-2xl border border-orange-300 bg-orange-50 p-4">
          <p className="font-bold">{problem.error}</p>
          {problem.alternatives && problem.alternatives.length > 0 ? (
            <>
              <p className="text-sm text-stone-700">These are the closest. Tap one and we&rsquo;ll keep your details.</p>
              <div className="grid grid-cols-3 gap-2">
                {problem.alternatives.map((a) => (
                  <button
                    key={a.start}
                    type="button"
                    onClick={() => {
                      onSlot(a);
                      setProblem(null);
                    }}
                    className="flex h-14 flex-col items-center justify-center rounded-xl border-2 border-stone-300 bg-white"
                  >
                    <span className="font-bold">{timeText(a.start, salon.timeZone)}</span>
                    <span className="text-xs text-stone-600">{shortDay(a.start, slot.start, salon.timeZone)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <button type="button" onClick={onChangeTime} className="text-sm font-semibold underline">
            See other times
          </button>
        </div>
      ) : (
        <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200 px-4">
          <div className="flex items-center gap-3 py-3">
            <span className="flex flex-1 flex-col">
              <span className="text-sm text-stone-600">When</span>
              <span className="font-semibold">
                {longDay(dateIn(slot.start, salon.timeZone), salon.timeZone, true)}{" "}
                · {timeText(slot.start, salon.timeZone)}
              </span>
            </span>
            <button type="button" onClick={onChangeTime} className="px-1 py-2.5 text-sm font-semibold text-[var(--brand-ink)]">
              Change
            </button>
          </div>
          <div className="flex items-center gap-3 py-3">
            <span className="flex flex-1 flex-col">
              <span className="text-sm text-stone-600">Service</span>
              <span className="font-semibold">
                {service.name}
                {who ? ` with ${who}` : ""}
              </span>
              <span className="text-sm text-stone-600">
                {durationText(service.durationMinutes)}
                {service.priceMinor !== null ? ` · ${formatMoneyShort(service.priceMinor)}, paid at the salon` : ""}
              </span>
            </span>
            <button type="button" onClick={onChangeService} className="px-1 py-2.5 text-sm font-semibold text-[var(--brand-ink)]">
              Change
            </button>
          </div>
        </div>
      )}

      <h1 className="font-heading text-2xl font-extrabold tracking-tight">Who&rsquo;s it for?</h1>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Your name</span>
        <input
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-[3.25rem] rounded-xl border border-stone-400 px-3.5 text-[1.05rem] outline-none focus:border-stone-900 focus:ring-2 focus:ring-[var(--brand)]/30"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Mobile number</span>
        <input
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={problem?.code === "phone"}
          className="h-[3.25rem] rounded-xl border border-stone-400 px-3.5 text-[1.05rem] outline-none focus:border-stone-900 focus:ring-2 focus:ring-[var(--brand)]/30"
        />
        <span className="text-sm text-stone-600">We&rsquo;ll text your confirmation and a reminder before your visit.</span>
      </label>

      {/* Never shown to a person; a bot fills in every field. */}
      <label className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        Company
        <input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
      </label>

      {showNotes ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Note for the salon (optional)</span>
          <textarea
            value={notes}
            maxLength={500}
            rows={3}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-xl border border-stone-400 px-3.5 py-2.5 outline-none focus:border-stone-900"
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="self-start py-2 text-[0.95rem] font-semibold text-[var(--brand-ink)]"
        >
          + Add a note for the salon
        </button>
      )}

      {problem && !timeGone && (
        <p role="alert" className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm">
          {problem.error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-stone-200 bg-white px-4 pb-4 pt-3">
        <button
          type="submit"
          disabled={sending || Boolean(timeGone)}
          className="flex h-14 w-full items-center justify-center rounded-full text-[1.05rem] font-semibold disabled:opacity-60"
          style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
        >
          {sending ? "Booking…" : "Confirm booking"}
        </button>
        <p className="text-center text-xs text-stone-600">No account needed. You&rsquo;ll get a text to confirm.</p>
      </div>
    </form>
  );
}

function dateIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso)
  );
}

/** "Today", or the day, when an alternative is not on the day first chosen. */
function shortDay(iso: string, wanted: string, timeZone: string): string {
  const d = dateIn(iso, timeZone);
  if (d === dateIn(wanted, timeZone)) return "Same day";
  return dayLabel(d, timeZone).dow + " " + dayLabel(d, timeZone).date;
}

function DoneStep({
  salon,
  booked,
  onAgain,
  onClose,
}: {
  salon: PublicSalon;
  booked: Booked;
  onAgain: () => void;
  onClose?: () => void;
}) {
  const first = booked.name.split(/\s+/)[0];
  const ics = icsFor({
    start: booked.start,
    durationMinutes: salon.services.find((s) => s.name === booked.service)?.durationMinutes ?? 60,
    title: `${booked.service} at ${salon.name}`,
    location: salon.address,
    description: booked.bookingNumber ? `Booking ${booked.bookingNumber}` : "",
  });
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-green-100">
          <Check className="h-9 w-9 text-green-700" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <h1 className="font-heading text-[1.75rem] font-extrabold tracking-tight" tabIndex={-1}>
          You&rsquo;re booked{first ? `, ${first}` : ""}
        </h1>
        <p className="text-stone-600">
          {booked.textSent ? "We've texted you the details." : "Keep a note of the details below."}
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-stone-200 p-5">
        {booked.bookingNumber !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-stone-600">Booking number</span>
            <span className="font-bold tracking-wide">{booked.bookingNumber}</span>
          </div>
        )}
        <div className="space-y-1">
          <p className="font-heading text-xl font-bold">
            {longDay(dateIn(booked.start, salon.timeZone), salon.timeZone, true)} · {timeText(booked.start, salon.timeZone)}
          </p>
          <p>
            {booked.service}
            {booked.stylist ? ` with ${booked.stylist}` : ""}
          </p>
          {salon.address && <p className="text-sm text-stone-600">{salon.address}</p>}
        </div>
        {booked.skinTest && (
          <p className="flex gap-2 rounded-xl bg-sky-50 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" aria-hidden="true" />
            You&rsquo;ll need a skin test at the salon at least 48 hours before. The salon will be in touch to arrange it.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <a
            href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`}
            download="appointment.ics"
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-stone-300 text-[0.95rem] font-semibold"
          >
            <Calendar className="h-4 w-4" aria-hidden="true" /> Add to calendar
          </a>
          {salon.address ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${salon.name}, ${salon.address}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-stone-300 text-[0.95rem] font-semibold"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" /> Directions
            </a>
          ) : salon.phone ? (
            <a
              href={`tel:${salon.phone}`}
              className="flex h-12 items-center justify-center rounded-xl border border-stone-300 text-[0.95rem] font-semibold"
            >
              Call the salon
            </a>
          ) : null}
        </div>
      </div>

      {salon.phone && (
        <p className="text-center text-sm text-stone-600">
          Need to change it? Ring us on{" "}
          <a className="font-semibold underline" href={`tel:${salon.phone}`}>
            {salon.phone}
          </a>
          .
        </p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAgain}
          className="h-12 rounded-full border border-stone-300 font-semibold"
        >
          Book someone else
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="h-12 rounded-full font-semibold text-stone-700">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
