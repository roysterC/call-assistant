"use client";

/**
 * The in-person lead funnel: one question a screen, big enough to fill in on
 * a phone or a tablet handed across a counter. Enter (or a tap) moves on;
 * yes/no and the system pick move on by themselves. Nothing is sent until the
 * last answer, and the thank-you screen clears itself for the next person, so
 * the tablet never shows the last person's details for long.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarCheck, Check, Loader2 } from "lucide-react";
import { BrandMark } from "@/components/dashboard/sidebar";
import { cn } from "@/lib/utils";
import {
  KNOWN_SYSTEMS,
  checkBusinessName,
  checkEmail,
  checkOwnerName,
  checkPhone,
  type Checked,
  type FunnelField,
} from "@/lib/funnel";

type Step = "hasSystem" | "system" | "businessName" | "ownerName" | "phone" | "email";

interface Answers {
  hasSystem: boolean | null;
  system: string;
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
}

const EMPTY: Answers = { hasSystem: null, system: "", businessName: "", ownerName: "", phone: "", email: "" };

/** "Which one?" only follows a yes. */
function stepsFor(hasSystem: boolean | null): Step[] {
  return hasSystem === true
    ? ["hasSystem", "system", "businessName", "ownerName", "phone", "email"]
    : ["hasSystem", "businessName", "ownerName", "phone", "email"];
}

/** Seconds the thank-you screen stays before clearing for the next person. */
const RESET_AFTER = 20;

/** Minutes the booking screen waits, untouched, before moving on by itself. */
const CALL_IDLE_MINUTES = 5;

/** After the questions: the offer of a call, then thanks. */
type Stage = "questions" | "call" | "done";

interface TextStep {
  question: string;
  hint?: string;
  placeholder: string;
  type: string;
  inputMode?: "text" | "tel" | "email";
  autoComplete: string;
  check: (v: unknown) => Checked<string>;
}

const TEXT_STEPS: Record<"businessName" | "ownerName" | "phone" | "email", TextStep> = {
  businessName: {
    question: "What's your business called?",
    placeholder: "Business name",
    type: "text",
    autoComplete: "organization",
    check: checkBusinessName,
  },
  ownerName: {
    question: "And the owner's name?",
    hint: "Yours, if it's you.",
    placeholder: "Full name",
    type: "text",
    autoComplete: "name",
    check: checkOwnerName,
  },
  phone: {
    question: "Best number to reach you on?",
    placeholder: "07700 900123",
    type: "tel",
    inputMode: "tel",
    autoComplete: "tel",
    check: checkPhone,
  },
  email: {
    question: "And your email?",
    placeholder: "name@business.co.uk",
    type: "email",
    inputMode: "email",
    autoComplete: "email",
    check: checkEmail,
  },
};

/**
 * @param bookingUrl  The Calendly page for a 30-minute discovery call
 *   (DISCOVERY_CALL_URL). Without one, the funnel ends at the thank-you.
 */
export function LeadFunnel({ bookingUrl }: { bookingUrl?: string | null }) {
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [step, setStep] = useState<Step>("hasSystem");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<Stage>("questions");
  const [booked, setBooked] = useState(false);
  const [honeypot, setHoneypot] = useState("");

  const done = stage === "done";
  const steps = stepsFor(answers.hasSystem);
  // The booking screen counts as the last step.
  const total = steps.length + (bookingUrl ? 1 : 0);
  const index = stage === "call" ? steps.length : steps.indexOf(step);
  const progress = done ? 1 : index / total;

  const go = (to: Step) => {
    setError(null);
    setStep(to);
  };
  const next = (from: Step = step, hasSystem = answers.hasSystem) => {
    const order = stepsFor(hasSystem);
    const i = order.indexOf(from);
    if (i < order.length - 1) go(order[i + 1]);
  };
  const back = () => index > 0 && go(steps[index - 1]);

  const reset = () => {
    setAnswers(EMPTY);
    setHoneypot("");
    setBooked(false);
    setStage("questions");
    go("hasSystem");
  };

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...answers, website: honeypot }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; field?: FunnelField };
      if (!res.ok) {
        if (data.field && data.field !== "hasSystem" && data.field !== step) setStep(data.field);
        setError(data.error || "Something went wrong. Try again.");
        return;
      }
      setStage(bookingUrl ? "call" : "done");
    } catch {
      setError("No connection. Check the internet and try again.");
    } finally {
      setSending(false);
    }
  }

  function continueFromText(field: keyof typeof TEXT_STEPS) {
    const checked = TEXT_STEPS[field].check(answers[field]);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    if (field === "email") void submit();
    else next(field);
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      <header className="shrink-0">
        <div className="h-1 bg-tea-green-800" aria-hidden>
          <div
            className="h-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(progress * 100, 3)}%` }}
          />
        </div>
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark size="sm" />
            <span className="font-heading font-semibold tracking-tight">Kikai</span>
          </div>
          {!done && (
            <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {index + 1} of {total}
            </span>
          )}
        </div>
      </header>

      <main className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-2xl px-5 pb-16 sm:px-8">
          {/* No person fills this in; a bot filling every field does. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            className="absolute -left-[9999px] h-px w-px opacity-0"
          />

          {stage === "done" ? (
            <Done name={answers.ownerName} email={answers.email} booked={booked} onReset={reset} />
          ) : stage === "call" && bookingUrl ? (
            <BookCall
              number={index + 1}
              url={bookingUrl}
              name={answers.ownerName}
              email={answers.email}
              onBooked={() => setBooked(true)}
              onFinish={() => setStage("done")}
            />
          ) : (
            <div key={step} className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              {step === "hasSystem" && (
                <ChoiceStep
                  number={index + 1}
                  question="Do you already use a booking system?"
                  hint="Software for the diary, like Fresha or Phorest."
                  options={[
                    { label: "Yes", key: "y", value: true },
                    { label: "No", key: "n", value: false },
                  ]}
                  selected={answers.hasSystem}
                  onPick={(v) => {
                    setAnswers((a) => ({ ...a, hasSystem: v, system: v ? a.system : "" }));
                    next("hasSystem", v);
                  }}
                />
              )}

              {step === "system" && (
                <SystemStep
                  number={index + 1}
                  value={answers.system}
                  onChange={(system) => setAnswers((a) => ({ ...a, system }))}
                  onNext={() => next("system")}
                />
              )}

              {(step === "businessName" || step === "ownerName" || step === "phone" || step === "email") && (
                <TextQuestion
                  number={index + 1}
                  {...TEXT_STEPS[step]}
                  value={answers[step]}
                  error={error}
                  last={step === "email"}
                  sending={sending}
                  onChange={(v) => {
                    setError(null);
                    setAnswers((a) => ({ ...a, [step]: v }));
                  }}
                  onNext={() => continueFromText(step)}
                />
              )}

              {(step === "hasSystem" || step === "system") && error && (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="mt-10 flex items-center gap-4">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 -ml-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Eyebrow({ number }: { number: number }) {
  return (
    <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-primary">
      {number} <ArrowRight className="h-3.5 w-3.5" />
    </p>
  );
}

function Question({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h1 id={id} className="font-heading text-2xl font-semibold leading-tight sm:text-4xl">
      {children}
    </h1>
  );
}

function ChoiceStep<T>({
  number,
  question,
  hint,
  options,
  selected,
  onPick,
}: {
  number: number;
  question: string;
  hint?: string;
  options: { label: string; key: string; value: T }[];
  selected: T | null;
  onPick: (v: T) => void;
}) {
  // Y / N from the keyboard, for a laptop on the counter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const hit = options.find((o) => o.key === e.key.toLowerCase());
      if (hit) onPick(hit.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onPick]);

  return (
    <div role="group" aria-labelledby="funnel-q">
      <Eyebrow number={number} />
      <Question id="funnel-q">{question}</Question>
      {hint && <p className="mt-3 text-base text-muted-foreground sm:text-lg">{hint}</p>}
      <div className="mt-8 grid max-w-sm grid-cols-2 gap-3">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => onPick(o.value)}
            className={cn(
              "flex h-16 items-center justify-between rounded-xl border-2 px-4 text-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected === o.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary/60 hover:bg-tea-green-900"
            )}
          >
            {o.label}
            <kbd className="hidden rounded border border-current/30 px-1.5 text-xs uppercase opacity-60 sm:inline">
              {o.key}
            </kbd>
          </button>
        ))}
      </div>
    </div>
  );
}

function SystemStep({
  number,
  value,
  onChange,
  onNext,
}: {
  number: number;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const known = (KNOWN_SYSTEMS as readonly string[]).includes(value);
  const [other, setOther] = useState(value && !known ? value : "");

  return (
    <div role="group" aria-labelledby="funnel-q">
      <Eyebrow number={number} />
      <Question id="funnel-q">Which one?</Question>
      <p className="mt-3 text-base text-muted-foreground sm:text-lg">Tap one, or skip.</p>
      <div className="mt-8 flex flex-wrap gap-2.5">
        {KNOWN_SYSTEMS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              onChange(s);
              onNext();
            }}
            className={cn(
              "h-12 rounded-full border-2 px-5 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              value === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary/60 hover:bg-tea-green-900"
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <form
        className="mt-6 flex max-w-md items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onChange(other.trim());
          onNext();
        }}
      >
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Something else"
          aria-label="Another booking system"
          maxLength={60}
          className="h-12 flex-1 rounded-xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
        />
        <button
          type="submit"
          className="h-12 rounded-xl bg-primary px-5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {other.trim() ? "OK" : "Skip"}
        </button>
      </form>
    </div>
  );
}

function TextQuestion({
  number,
  question,
  hint,
  placeholder,
  type,
  inputMode,
  autoComplete,
  value,
  error,
  last,
  sending,
  onChange,
  onNext,
}: TextStep & {
  number: number;
  value: string;
  error: string | null;
  last: boolean;
  sending: boolean;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focus without the page jumping, and after the slide-in has started.
    const t = setTimeout(() => input.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!sending) onNext();
      }}
    >
      <Eyebrow number={number} />
      <label htmlFor="funnel-input" className="block">
        <Question id="funnel-q">{question}</Question>
      </label>
      {hint && <p className="mt-3 text-base text-muted-foreground sm:text-lg">{hint}</p>}
      <input
        ref={input}
        id="funnel-input"
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize={type === "text" ? "words" : "off"}
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint={last ? "send" : "next"}
        placeholder={placeholder}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "funnel-error" : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          // 16px and up, or iPhones zoom the page on focus.
          "mt-8 w-full border-0 border-b-2 bg-transparent pb-2 text-2xl outline-none transition-colors placeholder:text-muted-foreground/50 sm:text-3xl",
          error ? "border-destructive" : "border-border focus:border-primary"
        )}
      />
      <p id="funnel-error" role="alert" className="mt-3 min-h-5 text-sm text-destructive">
        {error}
      </p>
      {last && (
        <p className="mt-2 text-xs text-muted-foreground">
          We&apos;ll only use these details to get in touch about Kikai.{" "}
          <a href="/privacy-policy" target="_blank" className="underline underline-offset-2 hover:text-foreground">
            Privacy policy
          </a>
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending
            </>
          ) : last ? (
            <>
              Send <Check className="h-4 w-4" />
            </>
          ) : (
            <>
              OK <Check className="h-4 w-4" />
            </>
          )}
        </button>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          or press <kbd className="font-medium">Enter ↵</kbd>
        </span>
      </div>
    </form>
  );
}

/** Calendly's own page, with their name and email already filled in. */
export function calendlyEmbedUrl(base: string, who: { name: string; email: string }, host: string): string {
  const url = new URL(base);
  url.searchParams.set("name", who.name.trim());
  url.searchParams.set("email", who.email.trim());
  url.searchParams.set("embed_type", "Inline");
  url.searchParams.set("embed_domain", host);
  url.searchParams.set("hide_gdpr_banner", "1");
  url.searchParams.set("utm_source", "in-person-funnel");
  return url.toString();
}

function BookCall({
  number,
  url,
  name,
  email,
  onBooked,
  onFinish,
}: {
  number: number;
  url: string;
  name: string;
  email: string;
  onBooked: () => void;
  onFinish: () => void;
}) {
  const [src] = useState(() => calendlyEmbedUrl(url, { name, email }, window.location.host));
  const [booked, setBooked] = useState(false);

  // Calendly tells the page when a time is booked; then this screen is done.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)?calendly\.com$/.test(e.origin)) return;
      const data = e.data as { event?: string } | null;
      if (data?.event === "calendly.event_scheduled") {
        setBooked(true);
        onBooked();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onBooked]);

  // A tablet left on this screen moves on by itself, so the next person
  // never finds someone else's name filled in.
  useEffect(() => {
    const t = setTimeout(onFinish, (booked ? 0.25 : CALL_IDLE_MINUTES) * 60_000);
    return () => clearTimeout(t);
  }, [booked, onFinish]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
      <Eyebrow number={number} />
      <h1 className="font-heading text-2xl font-semibold leading-tight sm:text-4xl">
        Book a 30-minute discovery call?
      </h1>
      <p className="mt-3 text-base text-muted-foreground sm:text-lg">
        Your details are saved. Pick a time that suits you, and we&apos;ll show you how it would work for your salon.
      </p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <iframe
          src={src}
          title="Book a 30-minute discovery call"
          className="block h-[680px] w-full sm:h-[720px]"
        />
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onFinish}
          className={cn(
            "inline-flex h-12 items-center gap-2 rounded-xl px-5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            booked
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-2 border-border bg-card hover:border-primary/60"
          )}
        >
          {booked ? (
            <>
              Done <Check className="h-4 w-4" />
            </>
          ) : (
            <>
              Not now <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Done({
  name,
  email,
  booked,
  onReset,
}: {
  name: string;
  email: string;
  booked: boolean;
  onReset: () => void;
}) {
  const [left, setLeft] = useState(RESET_AFTER);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onReset();
  }, [left, onReset]);

  const first = name.trim().split(/\s+/)[0];
  return (
    <div className="animate-in fade-in zoom-in-95 duration-300" role="status">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-7 w-7" />
      </div>
      <h1 className="font-heading text-3xl font-semibold leading-tight sm:text-4xl">
        Thanks{first ? `, ${first}` : ""}.
      </h1>
      {booked ? (
        <p className="mt-3 flex items-start gap-2 text-lg text-muted-foreground">
          <CalendarCheck className="mt-1 h-5 w-5 shrink-0 text-primary" />
          <span>
            Your discovery call is booked. The invite is on its way
            {email ? <> to <span className="text-foreground">{email.trim()}</span></> : null}.
          </span>
        </p>
      ) : (
        <p className="mt-3 text-lg text-muted-foreground">
          We&apos;ll be in touch{email ? <> at <span className="text-foreground">{email.trim()}</span></> : null}.
        </p>
      )}
      <button
        type="button"
        onClick={onReset}
        autoFocus
        className="mt-10 inline-flex h-12 items-center gap-2 rounded-xl border-2 border-border bg-card px-5 font-medium hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Next person <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-3 text-xs text-muted-foreground">Clears in {Math.max(left, 0)}s</p>
    </div>
  );
}
