"use client";

/**
 * Beside a chat: what to do about this person now, then who they are.
 *
 * The card at the top is the next step, in order of urgency: a message
 * Kikai took for the team, a client waiting for a reply, or someone new.
 * When a booking came of the chat there is nothing to do, and it says so.
 * Under it: their next visit, notes, recent visits and who they book for;
 * or, for someone with no bookings yet, what Kikai knows about them.
 */

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check, ChevronRight, Copy, Pencil, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { formatMoneyShort } from "@/lib/money";
import { CHANNEL_META, avatarColorFor, channelLabel, initialsFor } from "@/lib/channels";
import { DATE_FNS_LOCALE, type Translate } from "@/lib/i18n";
import { useT } from "@/components/providers/language-provider";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { waitedFor } from "@/components/conversations/conversation-list-item";
import { ContactAvatar } from "@/components/conversations/contact-avatar";
import { normalisePhone } from "@/lib/phone";
import type { ConversationDetail, ConversationState } from "@/components/conversations/types";

interface ClientPanelProps {
  conversation: ConversationDetail;
  /** What the chat needs, from the list (src/lib/conversation-state.ts). */
  state?: ConversationState;
  /** The name the chat goes by, as in its header. */
  title: string;
  /** Website only: take the chat over from Kikai. */
  onTakeOver?: () => void;
  /** After a change here (a message marked done, notes saved): fetch the chat again. */
  onChanged: () => void;
  /** Owners only. */
  onResetPersona?: () => void;
  /** When shown over the chat (below the widest screens). */
  onClose?: () => void;
}

/** A UK number as people write it, "07700 900123"; anything else as it was stored. */
/** The same number however it was typed: "07700 900123" and "+447700900123". */
function samePhone(a: string, b: string): boolean {
  const x = normalisePhone(a);
  const y = normalisePhone(b);
  return x.ok && y.ok ? x.e164 === y.e164 : a.replace(/\D/g, "") === b.replace(/\D/g, "");
}

export function displayPhone(phone: string): string {
  const uk = /^\+44(\d{4})(\d{6})$/.exec(phone.replace(/\s+/g, ""));
  return uk ? `0${uk[1]} ${uk[2]}` : phone;
}

/** How to reach them, from the channel they wrote on: a number, an @username or an email. */
export function contactLine(c: ConversationDetail, t: Translate): { value: string | null; channel: string } {
  const label = channelLabel(c.channel, t);
  const phone = c.client?.phone || c.lead?.phone || null;
  switch (c.channel) {
    case "whatsapp":
      return { value: displayOrNull(c.phoneNumber || phone), channel: label };
    case "instagram":
      return { value: c.handle ? `@${c.handle}` : displayOrNull(phone), channel: label };
    case "facebook":
      return { value: displayOrNull(phone), channel: label };
    case "website":
      return {
        value: c.visitorPhone || c.visitorEmail || displayOrNull(phone) || c.client?.email || null,
        channel: t("channel.website"),
      };
  }
}

function displayOrNull(phone: string | null): string | null {
  return phone ? displayPhone(phone) : null;
}

export function ClientPanel({
  conversation: c,
  state,
  title,
  onTakeOver,
  onChanged,
  onResetPersona,
  onClose,
}: ClientPanelProps) {
  const { t, clock, lang } = useT();
  const { notify } = useDialogs();
  const client = c.client;
  const reach = contactLine(c, t);
  const meta = CHANNEL_META[c.channel];
  const [copied, setCopied] = useState(false);
  const time = (iso: string) => format(new Date(iso), clock === "24h" ? "HH:mm" : "h:mmaaa");
  const day = (iso: string, pattern: string) => format(new Date(iso), pattern, { locale: DATE_FNS_LOCALE[lang] });
  const phone = client?.phone || c.lead?.phone || (c.channel === "whatsapp" ? c.phoneNumber : null) || c.visitorPhone || null;
  const isClient = Boolean(client?.isClient);
  // On the website anyone can type a client's email, so a number given there
  // never replaces the one on her record (src/lib/website-lead.ts). When it
  // differs, staff should see both before trusting either.
  const onFile = client?.phone || c.lead?.phone || null;
  const otherNumber =
    c.channel === "website" && c.visitorPhone && onFile && !samePhone(c.visitorPhone, onFile) ? c.visitorPhone : null;

  async function copyReach() {
    if (!reach.value) return;
    await navigator.clipboard?.writeText(reach.value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function markDone(id: string) {
    const res = await apiFetch("/api/callbacks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "completed" }),
    }).catch(() => null);
    if (!res?.ok) {
      notify(t("panel.markFailed"));
      return;
    }
    onChanged();
  }

  const lastClientMessage = [...c.messages].reverse().find((m) => m.role === "user");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-[18px] py-4">
        <span className="relative shrink-0">
          <ContactAvatar
            src={c.profilePicUrl}
            initials={initialsFor(c.contactName || c.lead?.name || null, c.phoneNumber || title)}
            colourClass={avatarColorFor(title)}
            size={46}
            className="h-[46px] w-[46px] text-[15px] font-bold"
          />
          {meta && (
            <span
              title={channelLabel(c.channel, t)}
              className={cn("absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card", meta.bg)}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-[17px] font-extrabold">{title}</h2>
          {reach.value ? (
            <button
              type="button"
              onClick={copyReach}
              title={t("panel.copy", { value: reach.value })}
              className="group mt-0.5 flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">
                {reach.value} · {reach.channel}
              </span>
              {copied ? (
                <Check className="h-3 w-3 shrink-0" aria-label={t("panel.copied")} />
              ) : (
                <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden />
              )}
            </button>
          ) : (
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{reach.channel}</p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("panel.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[18px] pb-5 pt-4">
        {client?.waiting ? (
          <StepCard
            tone="amber"
            kicker={t("panel.messageKicker", { waited: waitedFor(client.waiting.createdAt, t) })}
            title={client.waiting.message ? `“${client.waiting.message}”` : t("panel.tookMessage")}
            body={t("panel.tookMessageBody")}
            primary={phone ? { label: t("panel.call", { phone: displayPhone(phone) }), href: `tel:${phone.replace(/\s+/g, "")}`, icon: true } : undefined}
            secondary={{ label: phone ? t("panel.calledDone") : t("panel.markDone"), onClick: () => markDone(client.waiting!.id) }}
          />
        ) : state?.kind === "waiting" ? (
          <StepCard
            tone="amber"
            kicker={t("panel.waitingKicker", { waited: waitedFor(c.lastMessageAt, t) })}
            title={lastClientMessage ? `“${clip(lastClientMessage.content)}”` : t("panel.waitingTitle")}
            body={c.channel === "website" ? t("panel.waitingWebsite") : t("panel.waitingOther")}
            primary={
              c.channel === "website" && onTakeOver
                ? { label: t("panel.takeOver"), onClick: onTakeOver }
                : phone
                  ? { label: t("panel.call", { phone: displayPhone(phone) }), href: `tel:${phone.replace(/\s+/g, "")}`, icon: true }
                  : undefined
            }
          />
        ) : !isClient ? (
          <StepCard
            tone="violet"
            kicker={t("panel.newKicker")}
            title={c.lead?.issue || t("panel.noBooking")}
            body={t("panel.newBody")}
            secondary={{ label: t("panel.bookInDiary"), href: "/calendar" }}
          />
        ) : client?.next?.bookedInChat ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-tea-green-200">
            <Check className="h-4 w-4" aria-hidden />
            {t("panel.bookedInChat")}
          </p>
        ) : null}

        {client?.next && (
          <Link
            href={withAsOrg(`/calendar?date=${client.next.day}&booking=${encodeURIComponent(client.next.id)}`)}
            className="flex items-center gap-3 rounded-2xl bg-primary px-4 py-3.5 text-primary-foreground hover:bg-tea-green-100"
          >
            <span className="w-[46px] shrink-0 rounded-[10px] bg-white/15 py-1.5 text-center">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.06em]">
                {day(client.next.startsAt, "EEE")}
              </span>
              <span className="block text-[19px] font-extrabold leading-tight">{format(new Date(client.next.startsAt), "d")}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-semibold opacity-80">
                {client.next.bookedInChat ? t("panel.nextInChat") : t("panel.next")}
              </span>
              <span className="block truncate text-[14.5px] font-bold">
                {client.next.serviceText} · {time(client.next.startsAt)}
              </span>
              <span className="block truncate text-[12.5px] opacity-85">
                {t("panel.withFor", { stylist: client.next.stylistName, minutes: client.next.durationMinutes })}
                {client.next.photos > 0 && t("panel.photos", { n: client.next.photos })}
              </span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0" aria-hidden />
          </Link>
        )}

        {client && isClient && <Notes clientId={client.id} notes={client.notes} onSaved={onChanged} />}

        {client && isClient && (
          <section className="flex flex-col">
            <div className="mb-1 flex items-baseline">
              <h3 className="flex-1 text-[13px] font-bold">{t("panel.recent")}</h3>
              {client.visits > 0 && (
                <Link href={withAsOrg(`/clients?client=${encodeURIComponent(client.id)}`)} className="text-[12.5px] font-semibold text-primary hover:underline">
                  {t("panel.seeAll")}
                </Link>
              )}
            </div>
            {client.recent.length === 0 ? (
              <p className="py-2 text-[13px] text-muted-foreground">{t("panel.noVisits")}</p>
            ) : (
              client.recent.map((v) => (
                <Link
                  key={v.id}
                  href={withAsOrg(`/calendar?date=${v.day}&booking=${encodeURIComponent(v.id)}`)}
                  className="-mx-1.5 flex items-center gap-2.5 rounded-md border-b border-tea-green-900 px-1.5 py-2 text-[13px] transition-colors last:border-b-0 hover:bg-tea-green-900"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-tea-green-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{v.serviceText}</span>
                    <span className="block text-xs text-muted-foreground">
                      {day(v.startsAt, "d MMM")} · {v.stylistName}
                    </span>
                  </span>
                  {v.amountMinor !== null && (
                    <span className="font-semibold tabular-nums">{formatMoneyShort(v.amountMinor)}</span>
                  )}
                </Link>
              ))
            )}
          </section>
        )}

        {client && isClient && client.booksFor.length > 0 && (
          <p className="text-[12.5px] text-muted-foreground">
            {t("panel.alsoBooksFor")}{" "}
            <strong className="font-semibold text-foreground">
              {client.booksFor.map((d) => d.name || t("panel.someone")).join(", ")}
            </strong>
          </p>
        )}

        {otherNumber && (
          <p role="note" className="rounded-xl border border-papaya-whip-400 bg-papaya-whip-800 px-3 py-2 text-[13px] leading-snug text-papaya-whip-100">
            <strong>{t("panel.otherNumberStrong", { phone: displayPhone(otherNumber) })}</strong>{" "}
            {t("panel.otherNumberRest", { onFile: displayPhone(onFile!) })}
          </p>
        )}
        {!isClient && (
          <section className="flex flex-col gap-2.5">
            <h3 className="text-[13px] font-bold">{t("panel.knows")}</h3>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted-foreground">{t("panel.name")}</dt>
              <dd className={cn(!(client?.name || c.contactName) && "text-muted-foreground")}>
                {client?.name || c.contactName || t("panel.notGiven")}
              </dd>
              <dt className="text-muted-foreground">{t("panel.phone")}</dt>
              <dd className={cn(!phone && "text-muted-foreground")}>{phone ? displayPhone(phone) : t("panel.notGiven")}</dd>
              {(client?.email || c.visitorEmail) && (
                <>
                  <dt className="text-muted-foreground">{t("panel.email")}</dt>
                  <dd className="truncate">{client?.email || c.visitorEmail}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t("panel.firstSeen")}</dt>
              <dd>{day(c.createdAt, "d MMM")}, {time(c.createdAt)}</dd>
              <dt className="text-muted-foreground">{t("panel.cameFrom")}</dt>
              <dd>{c.channel === "website" ? c.site?.name || t("channel.website") : t("panel.channelMessage", { channel: channelLabel(c.channel, t) })}</dd>
            </dl>
          </section>
        )}
      </div>

      {(c.lead || onResetPersona) && (
        // Both links on the left: the assistant's floating button sits bottom right.
        <div className="flex items-center gap-4 border-t border-border px-[18px] py-3">
          {c.lead && (
            <Link
              href={withAsOrg(`/clients?client=${encodeURIComponent(c.lead.id)}`)}
              className="text-[13px] font-semibold text-primary hover:underline"
            >
              {t("panel.openClient")}
            </Link>
          )}
          {onResetPersona && (
            <button
              type="button"
              onClick={onResetPersona}
              title={c.personaResetAt ? t("panel.resetAt", { date: day(c.personaResetAt, "d MMM") }) : undefined}
              className="text-xs text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
            >
              {t("panel.reset")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A long message, cut for the card; the whole of it is in the thread. */
function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

type Action = { label: string; href?: string; onClick?: () => void; icon?: boolean };

const TONES = {
  amber: { box: "border-papaya-whip-400 bg-papaya-whip-900", ink: "text-amber-700", dot: "bg-amber-600", line: "border-papaya-whip-400" },
  violet: { box: "border-violet-200 bg-violet-50", ink: "text-violet-700", dot: "bg-violet-600", line: "border-violet-200" },
} as const;

function StepCard({
  tone,
  kicker,
  title,
  body,
  primary,
  secondary,
}: {
  tone: keyof typeof TONES;
  kicker: string;
  title: string;
  body: string;
  primary?: Action;
  secondary?: Action;
}) {
  const t = TONES[tone];
  const primaryClass =
    "flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-tea-green-100";
  const secondaryClass = cn(
    "flex h-9 items-center justify-center rounded-[10px] border bg-card px-3 text-[13px] font-semibold hover:bg-muted",
    t.line
  );
  return (
    <section className={cn("flex flex-col gap-2.5 rounded-[18px] border p-4", t.box)}>
      <span className={cn("flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.06em]", t.ink)}>
        <span className={cn("h-2 w-2 rounded-full", t.dot)} aria-hidden />
        {kicker}
      </span>
      <p className="text-[15.5px] font-bold leading-snug">{title}</p>
      <p className="text-[13px] leading-normal text-muted-foreground">{body}</p>
      {primary && <ActionButton action={primary} className={primaryClass} />}
      {secondary && <ActionButton action={secondary} className={secondaryClass} />}
    </section>
  );
}

function ActionButton({ action, className }: { action: Action; className: string }) {
  const inner = (
    <>
      {action.icon && <Phone className="h-4 w-4" aria-hidden />}
      {action.label}
    </>
  );
  if (action.href) {
    return action.href.startsWith("/") ? (
      <Link href={action.href} className={className}>
        {inner}
      </Link>
    ) : (
      <a href={action.href} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {inner}
    </button>
  );
}

/** Notes on a sticky note, edited where they are. */
function Notes({ clientId, notes, onSaved }: { clientId: string; notes: string | null; onSaved: () => void }) {
  const { t } = useT();
  const { notify } = useDialogs();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/clients/${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        notify(data.error || t("panel.notesFailed"));
        return;
      }
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-1 rounded-[14px] border border-papaya-whip-400 bg-cornsilk-700 px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <Pencil className="h-3.5 w-3.5 text-light-bronze-300" aria-hidden />
        <h3 className="flex-1 text-xs font-bold text-light-bronze-300">{t("panel.notes")}</h3>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(notes ?? "");
              setEditing(true);
            }}
            className="text-xs font-semibold text-light-bronze-300 hover:underline"
          >
            {notes ? t("common.edit") : t("panel.add")}
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            autoFocus
            aria-label={t("panel.notesLabel")}
            className="mt-1 w-full resize-y rounded-lg border border-papaya-whip-400 bg-card px-2.5 py-2 text-[13.5px] leading-normal focus:outline-none focus:ring-3 focus:ring-ring/40"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-8 rounded-lg px-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-8 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </>
      ) : (
        <p className={cn("whitespace-pre-wrap text-[13.5px] leading-normal", !notes && "text-muted-foreground")}>
          {notes || t("panel.noNotes")}
        </p>
      )}
    </section>
  );
}
