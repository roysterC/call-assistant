"use client";

/**
 * The salon's clients: searchable, and grouped by who needs attention (due
 * back, new, not seen for a while, a patch test needed), each row saying
 * what they usually have, when they were last in and what is next. Picking
 * one opens their profile beside the list (the whole screen on a phone).
 */

import { useCallback, useEffect, useState } from "react";
import { Contact, Search } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { ClientProfile } from "@/components/clients/client-profile";
import { apiFetch, withAsOrg } from "@/lib/api-fetch";
import { useT } from "@/components/providers/language-provider";
import { avatarColorFor, initialsFor } from "@/lib/channels";
import { DATE_FNS_LOCALE, INTL_LOCALE, type Clock, type Lang, type Translate } from "@/lib/i18n";
import type { VisitSummaryJson } from "@/lib/client-summary";
import { cn } from "@/lib/utils";

interface ClientRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  patchTestAt: string | null;
  contactLead: { name: string | null; phone: string | null } | null;
  lastVisit: string | null;
  visits: number;
  nextBooking: string | null;
  summary: VisitSummaryJson | null;
}

const PAGE = 50;
const GROUPS = ["all", "due", "new", "lapsed", "patch"] as const;
type Group = (typeof GROUPS)[number];

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The tag at the end of a row: the thing to know about them now. */
function rowTag(c: ClientRow, group: Group, t: Translate, lang: Lang, clock: Clock): { text: string; tone: "due" | "next" | "late" | "test" | "none" } {
  const s = c.summary;
  if (group === "patch") return { text: t("clients.tag.testNeeded"), tone: "test" };
  if (c.nextBooking) {
    const d = new Date(c.nextBooking);
    const text = d
      .toLocaleString(INTL_LOCALE[lang], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: clock === "12h" })
      .replace(/:00(?=\s?[ap]m)/i, "")
      .replace(/\s?([AP])M$/, (_, x: string) => `${x.toLowerCase()}m`);
    return { text, tone: "next" };
  }
  // Long gone first: "due back" months ago is better said as not seen.
  if (c.lastVisit) {
    const months = Math.floor((Date.now() - new Date(c.lastVisit).getTime()) / (30 * 86_400_000));
    if (months >= 3) return { text: t("clients.tag.notSeen", { n: months }), tone: "late" };
  }
  if (s?.due) {
    if (s.due.on <= todayLocal()) return { text: t("clients.tag.dueNow"), tone: "due" };
    const soon = new Date(`${s.due.on}T12:00:00Z`).toLocaleDateString(INTL_LOCALE[lang], { day: "numeric", month: "short", timeZone: "UTC" });
    return { text: t("clients.tag.dueSoon", { date: soon }), tone: "none" };
  }
  return { text: t("clients.nothingBooked"), tone: "none" };
}

const TAG_TONE = {
  due: "bg-cornsilk-800 text-cornsilk-100",
  next: "bg-tea-green-900 text-tea-green-100",
  late: "bg-red-50 text-red-800",
  test: "bg-papaya-whip-800 text-papaya-whip-100",
  none: "text-muted-foreground",
} as const;

export default function ClientsPage() {
  const { t, lang, clock } = useT();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // A phone shows the list or a profile; a wide screen both.
  const [phoneProfile, setPhoneProfile] = useState(false);

  // /clients?client=… (a chat's or a callback's "Open client page"): that client, open.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("client");
    if (!id) return;
    setOpenId(id);
    setPhoneProfile(true);
    window.history.replaceState(null, "", withAsOrg("/clients"));
  }, []);

  // Search as they type, once they pause.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(
    async (offset: number, withCounts: boolean) => {
      const qs = new URLSearchParams({
        limit: String(PAGE),
        offset: String(offset),
        sort: group === "lapsed" ? "lastVisit" : group === "patch" ? "nextBooking" : "firstName",
        dir: group === "lapsed" ? "desc" : "asc",
        detail: "1",
      });
      if (group !== "all") qs.set("group", group);
      if (search) qs.set("q", search);
      if (withCounts) qs.set("counts", "1");
      const res = await apiFetch(`/api/clients?${qs}`);
      if (!res.ok) throw new Error();
      return (await res.json()) as { clients: ClientRow[]; total: number; counts?: Record<string, number> };
    },
    [search, group]
  );

  /** From the top: on a new search or group, and after a change in a profile. */
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const d = await fetchPage(0, true);
      setClients(d.clients ?? []);
      setTotal(d.total ?? 0);
      if (d.counts) setCounts(d.counts);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function showMore() {
    setLoadingMore(true);
    try {
      const d = await fetchPage(clients.length, false);
      setClients((prev) => [...prev, ...(d.clients ?? [])]);
      setTotal(d.total ?? 0);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  // On a wide screen the first in the list is open until another is picked.
  const shownId = openId ?? clients[0]?.id ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      <section
        aria-label={t("clients.title")}
        className={cn(
          "w-full min-w-0 flex-col border-r border-border md:flex md:w-[27rem] md:shrink-0 lg:w-[34rem]",
          phoneProfile ? "hidden" : "flex"
        )}
      >
        <div className="shrink-0 px-4 pb-3 pt-5 md:px-5">
          <h1 className="font-heading text-[26px] font-extrabold tracking-tight">{t("clients.title")}</h1>
          <label className="mt-3 flex h-11 items-center gap-2 rounded-xl border border-input bg-card px-3.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("clients.searchLabel")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("clients.searchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
            />
          </label>
          <div role="group" aria-label={t("clients.groupsLabel")} className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:px-0">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={group === g}
                onClick={() => {
                  setGroup(g);
                  setOpenId(null);
                }}
                className={cn(
                  "h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition-colors",
                  group === g ? "border-foreground bg-foreground text-background" : "border-tea-green-700 bg-card hover:bg-tea-green-900"
                )}
              >
                {t(`clients.group.${g}`)}
                {counts && <span className="ml-1 font-medium opacity-70">{counts[g] ?? 0}</span>}
              </button>
            ))}
          </div>
          {group !== "all" && <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{t(`clients.groupHint.${group}`)}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          {failed && (
            <p role="alert" className="px-5 py-3 text-sm text-red-600">
              {t("clients.loadFailed")}
            </p>
          )}
          {loading ? (
            <div aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-3">
                  <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                  <div className="h-9 flex-1 animate-pulse rounded-lg bg-muted" />
                </div>
              ))}
            </div>
          ) : clients.length === 0 ? (
            <EmptyState
              icon={Contact}
              title={search ? t("clients.noMatch") : group === "all" ? t("clients.none") : t("clients.groupEmpty")}
              hint={search ? t("clients.noMatchHint") : group === "all" ? t("clients.noneHint") : t(`clients.groupHint.${group}`)}
            />
          ) : (
            <>
              <ul>
                {clients.map((c) => {
                  const on = c.id === shownId;
                  const tag = rowTag(c, group, t, lang, clock);
                  const usual = c.summary?.usual ? `${c.summary.usual.service} · ${c.summary.usual.stylist}` : c.phone ?? (c.contactLead ? t("clients.via", { name: c.contactLead.name ?? t("clients.anotherClient") }) : t("clients.noVisitsYet"));
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenId(c.id);
                          setPhoneProfile(true);
                        }}
                        aria-current={on ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors md:px-5",
                          on ? "md:bg-muted md:shadow-[inset_3px_0_0_var(--primary)]" : "hover:bg-muted/60"
                        )}
                      >
                        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13.5px] font-bold", avatarColorFor(c.id))} aria-hidden="true">
                          {initialsFor(c.name, c.phone ?? "?")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-bold">{c.name ?? c.phone ?? t("clients.rowLabel")}</span>
                          <span className="block truncate text-[12.5px] text-muted-foreground">{usual}</span>
                        </span>
                        <span className="hidden w-24 shrink-0 text-right text-[12.5px] text-muted-foreground lg:block">
                          {c.lastVisit ? formatDistanceToNowStrict(new Date(c.lastVisit), { addSuffix: true, locale: DATE_FNS_LOCALE[lang] }) : t("clients.notInYet")}
                        </span>
                        <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold", TAG_TONE[tag.tone])}>{tag.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between gap-3 px-5 py-4 text-[13px] text-muted-foreground">
                <span>{t("clients.showing", { n: clients.length, total })}</span>
                {clients.length < total && (
                  <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void showMore()}>
                    {loadingMore ? t("common.loading") : t("clients.showMore")}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section
        aria-label={t("client.client")}
        className={cn("min-w-0 flex-1 flex-col bg-card md:flex", phoneProfile && shownId ? "flex" : "hidden")}
      >
        {shownId ? (
          <ClientProfile
            key={shownId}
            clientId={shownId}
            onClose={() => {
              setPhoneProfile(false);
              setOpenId(null);
            }}
            onChanged={() => void load()}
          />
        ) : (
          !loading && <p className="m-auto text-sm text-muted-foreground">{t("clients.pickOne")}</p>
        )}
      </section>
    </div>
  );
}
