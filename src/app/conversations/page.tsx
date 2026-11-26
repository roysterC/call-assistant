"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  MessageCircle,
  Search,
  ArrowLeft,
  UserRound,
  X,
  Star,
  CalendarCheck,
  PhoneCall,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ConversationListItem } from "@/components/conversations/conversation-list-item";
import { ClientPanel } from "@/components/conversations/client-panel";
import { QuotePanel, type OpenQuote } from "@/components/conversations/quote-panel";
import { OPEN_QUOTE, quoteSeen } from "@/components/notifications/quote-alerts";
import type { Channel, ConversationDetail, ThreadEvent } from "@/components/conversations/types";
import { PhotoViewer } from "@/components/ui/photo-viewer";
import { ContactAvatar } from "@/components/conversations/contact-avatar";
import { withAsOrg } from "@/lib/api-fetch";
import { useT } from "@/components/providers/language-provider";
import { DATE_FNS_LOCALE, type Lang, type MessageKey, type Translate } from "@/lib/i18n";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { CHANNEL_META, avatarColorFor, channelLabel, initialsFor } from "@/lib/channels";
import type { ConversationGroup, ConversationState } from "@/lib/conversation-state";

interface ConversationSummary {
  id: string;
  channel: Channel;
  contactName: string | null;
  identifier: string;
  lastMessage: string | null;
  lastMessageAt: string;
  isRead: boolean;
  starred: boolean;
  status: string;
  createdAt: string;
  messageCount: number;
  lead: { id: string; name: string | null; company: string | null } | null;
  siteName?: string;
  // Social-channel profile data populated by Graph API on first contact
  // (see src/lib/meta-messaging.ts fetchSocialProfile). Optional / nullable
  // because non-social channels and senders with strict privacy don't have it.
  profilePicUrl?: string | null;
  handle?: string | null;
  /** Who sent the last message: "user" (the client), "assistant" (Kikai), "agent" (staff). */
  lastRole?: string | null;
  /** Needs you, Kikai is handling, or done, and what happened (src/lib/conversation-state.ts). */
  state?: ConversationState;
}

/**
 * The list's three groups, in the order a person works through them: those
 * waiting on someone first (longest waiting at the top), then what Kikai is
 * dealing with, then what is done, newest first.
 */
const GROUPS: { id: ConversationGroup; title: MessageKey; dot: string; ink: string }[] = [
  { id: "you", title: "convs.group.you", dot: "bg-orange-600", ink: "text-orange-800" },
  { id: "bot", title: "convs.group.bot", dot: "bg-tea-green-300", ink: "text-tea-green-200" },
  { id: "done", title: "convs.group.done", dot: "bg-tea-green-500", ink: "text-muted-foreground" },
];

function groupConversations(list: ConversationSummary[]) {
  return GROUPS.map((g) => {
    const rows = list.filter((c) => (c.state?.group ?? "bot") === g.id);
    if (g.id === "you") rows.sort((a, b) => new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime());
    return { ...g, rows };
  }).filter((g) => g.rows.length > 0);
}

/** Which side of the thread a role sits on. "agent" is us, same as the bot. */
function isUserSide(role: string): boolean {
  return role === "user";
}

function isSameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * "Today" / "Yesterday" / a date, for the separators between days.
 *
 * Relative words first because most of what an operator reads is recent, and
 * "Today" answers the question faster than a date they have to compare against
 * one they half-remember.
 */
function dayLabel(dateStr: string, t: Translate, locale: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(dateStr, today.toISOString())) return t("convs.today");
  if (isSameDay(dateStr, yesterday.toISOString())) return t("convs.yesterday");
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    // A year only when it isn't this one — "12 Sep" is enough until it isn't.
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

type Filter = "all" | "unread" | "recent" | "starred";
type ChannelFilter = "all" | "whatsapp" | "website" | "instagram" | "facebook";


const CHANNEL_TABS: { value: ChannelFilter }[] = [
  { value: "all" },
  { value: "whatsapp" },
  { value: "website" },
  { value: "instagram" },
  { value: "facebook" },
];

type ChannelFlags = {
  whatsapp: boolean;
  website: boolean;
  instagram: boolean;
  facebook: boolean;
};

export default function ConversationsPage() {
  const { confirm, notify } = useDialogs();
  // Resetting the bot's persona follows a change to its prompt: the owner's.
  const role = useMe()?.role;
  const isOwner = role === "admin" || role === "superAdmin";
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<ConversationDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel>("whatsapp");
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [switchingHandoff, setSwitchingHandoff] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  // `search` is what the user is typing right now; `searchDebounced` is
  // what we actually query against. The debounce stops every keystroke
  // from firing 4 parallel Prisma calls. 350ms balances responsiveness
  // and quietness.
  const [search, setSearch] = useState("");
  // Search sits behind an icon, so the list starts higher; open while searching.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDebounced, setSearchDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(search), 350);
    return () => clearTimeout(id);
  }, [search]);
  // Per-org channel feature flags. `null` while loading; once loaded, the
  // tab list is filtered to only enabled channels and any previously-
  // selected disabled channel auto-resets to "all".
  const [channelFlags, setChannelFlags] = useState<ChannelFlags | null>(null);

  // Load per-org channel feature flags once. Mirrors the sidebar's logic
  // (components/dashboard/sidebar.tsx) so disabled channels disappear from
  // both the side nav and the conversations tab list.
  useEffect(() => {
    apiFetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.settings) return;
        setChannelFlags({
          whatsapp: !!d.settings.whatsappEnabled,
          website: !!d.settings.chatbotEnabled,
          instagram: !!d.settings.instagramEnabled,
          facebook: !!d.settings.facebookEnabled,
        });
      })
      .catch(() => {});
  }, []);

  // If the current channelFilter is for a disabled channel, snap back to "all".
  useEffect(() => {
    if (!channelFlags) return;
    if (channelFilter === "all") return;
    if (!channelFlags[channelFilter]) setChannelFilter("all");
  }, [channelFlags, channelFilter]);

  const visibleChannelTabs = channelFlags
    ? CHANNEL_TABS.filter(
        (tab) => tab.value === "all" || channelFlags[tab.value]
      )
    : CHANNEL_TABS;
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  // A photo the client sent, open full size.
  const [photoOpen, setPhotoOpen] = useState<string | null>(null);
  // The open chat's latest quote for designs (src/lib/quotes.ts), and
  // whether its panel is open.
  const [quote, setQuote] = useState<OpenQuote | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const { t, clock, locale, lang } = useT();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter !== "all") params.set("filter", filter);
        if (channelFilter !== "all") params.set("channel", channelFilter);
        if (searchDebounced) params.set("search", searchDebounced);
        const res = await apiFetch(`/api/conversations?${params}`);
        const data = await res.json();
        setConversations(data.conversations || []);
      } catch (error) {
        if (!silent) console.error("Failed to fetch conversations:", error);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filter, channelFilter, searchDebounced]
  );

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const loadQuote = useCallback(async (id: string, channel: Channel) => {
    if (channel === "website") {
      setQuote(null);
      return;
    }
    try {
      const res = await apiFetch(`/api/quotes?channel=${channel}&conversationId=${encodeURIComponent(id)}`);
      const data = res.ok ? await res.json() : null;
      const found = (data?.quote as OpenQuote | null) ?? null;
      setQuote(found);
      if (found?.status === "requested") quoteSeen(found.id);
    } catch {
      // Without it the chat still shows; the bar and panel just wait.
    }
  }, []);

  // A quote's notification links to /conversations?c=…&ch=…&quote=1: open
  // that chat with its quote, once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get("c");
    const ch = q.get("ch") as Channel | null;
    if (!c || !ch) return;
    void selectConversation(c, ch);
    if (q.get("quote") === "1") setQuoteOpen(true);
    q.delete("c");
    q.delete("ch");
    q.delete("quote");
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Quote now" in the corner alert, while this page is open.
  useEffect(() => {
    const open = (e: Event) => {
      const { c, ch } = (e as CustomEvent<{ c: string; ch: Channel }>).detail ?? {};
      if (!c || !ch) return;
      void selectConversation(c, ch);
      setQuoteOpen(true);
    };
    window.addEventListener(OPEN_QUOTE, open);
    return () => window.removeEventListener(OPEN_QUOTE, open);
    // selectConversation reads the current selection each time it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Background refetch of the active conversation's messages — used by the
  // polling effect below. Does NOT trigger the read PATCH or mobile view
  // change; those only run on explicit user selection.
  const refetchActive = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await apiFetch(
        `/api/conversations/${selectedId}?channel=${selectedChannel}`
      );
      if (!res.ok) return;
      const data: ConversationDetail = await res.json();
      // Only update if the data is for the same conversation we still have
      // selected — avoids racing with a fast user selection switch.
      setActiveConversation((prev) =>
        prev && prev.id === data.id ? data : prev
      );
    } catch {
      // Background refresh — swallow errors silently.
    }
  }, [selectedId, selectedChannel]);

  /**
   * Send an operator reply. This also takes the conversation over from the
   * bot server-side, so the model stops answering the moment a person does.
   */
  // Derived as a boolean so the polling effect only re-runs when the state
  // actually flips — depending on activeConversation itself would restart the
  // interval on every tick, since the object identity changes each fetch.
  const liveHandoff =
    activeConversation?.channel === "website" &&
    !!activeConversation.handoffState &&
    activeConversation.handoffState !== "bot";

  const setHandoff = useCallback(
    async (state: "bot" | "human") => {
      if (!selectedId || switchingHandoff) return;
      setSwitchingHandoff(true);
      try {
        const res = await apiFetch(
          `/api/conversations/${selectedId}/handoff?channel=${selectedChannel}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state }),
          }
        );
        if (!res.ok) throw new Error("Handoff failed");
        await refetchActive();
      } catch (err) {
        console.error("Failed to change handoff state:", err);
        notify(t("convs.handoffFailed"));
      } finally {
        setSwitchingHandoff(false);
      }
    },
    [selectedId, selectedChannel, switchingHandoff, refetchActive, notify, t]
  );

  const sendReply = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = reply.trim();
      if (!text || !selectedId || replying) return;
      setReplying(true);
      try {
        const res = await apiFetch(
          `/api/conversations/${selectedId}/reply?channel=${selectedChannel}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text }),
          }
        );
        if (!res.ok) throw new Error("Reply failed");
        setReply("");
        await refetchActive();
      } catch (err) {
        console.error("Failed to send reply:", err);
        notify(t("convs.replyFailed"));
      } finally {
        setReplying(false);
      }
    },
    [reply, selectedId, selectedChannel, replying, refetchActive, notify, t]
  );

  // Poll every 15s for new messages on the list and on the active
  // conversation. Skips ticks when the tab is hidden so we don't spam the
  // API while idle. Polls also pause while the user is mid-search (the
  // debounce handles that — searchDebounced is the dep).
  useEffect(() => {
    // 15s is fine for bot conversations nobody is sitting on. While a person
    // is handling one it is a live chat, and a visitor waiting 15s for a reply
    // they already sent to appear reads as broken.
    const POLL_MS = liveHandoff ? 3_000 : 15_000;
    let timer: ReturnType<typeof setInterval> | null = null;
    function tick() {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchConversations(true);
      refetchActive();
    }
    timer = setInterval(tick, POLL_MS);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [fetchConversations, refetchActive, liveHandoff]);

  async function selectConversation(id: string, channel: Channel) {
    setSelectedId(id);
    setSelectedChannel(channel);
    if (id !== selectedId) setQuoteOpen(false);
    setQuote(null);
    void loadQuote(id, channel);
    setMobileView("chat");
    setLoadingDetail(true);
    try {
      const res = await apiFetch(`/api/conversations/${id}?channel=${channel}`);
      if (!res.ok) throw new Error("Not found");
      const data: ConversationDetail = await res.json();
      setActiveConversation(data);

      if (!data.isRead) {
        // Optimistic flip: mark read in the list immediately for snappy
        // UX, then await the PATCH and revert on failure. Earlier this
        // was fire-and-forget — a 500 left the UI showing read while the
        // DB still said unread, and the next reload looked stale.
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, isRead: true } : c))
        );
        try {
          const pr = await apiFetch(
            `/api/conversations/${id}/read?channel=${channel}`,
            { method: "PATCH" }
          );
          if (!pr.ok) throw new Error("read PATCH failed");
        } catch (err) {
          console.error("Failed to mark read:", err);
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, isRead: false } : c))
          );
        }
      }
    } catch (error) {
      console.error("Failed to fetch conversation:", error);
    } finally {
      setLoadingDetail(false);
    }
  }

  // Opening a chat lands on its latest message at once, before it is drawn,
  // rather than scrolling down through it; a new message in the chat already
  // open glides into view.
  const shownThread = useRef<string | null>(null);
  const threadKey = activeConversation ? `${activeConversation.channel}:${activeConversation.id}` : null;
  const threadMessages = activeConversation?.messages;
  useLayoutEffect(() => {
    if (!threadKey || !threadMessages) {
      shownThread.current = null;
      return;
    }
    const opened = threadKey !== shownThread.current;
    shownThread.current = threadKey;
    messagesEndRef.current?.scrollIntoView({ behavior: opened ? "instant" : "smooth", block: "end" });
  }, [threadKey, threadMessages]);

  async function toggleStar() {
    if (!activeConversation) return;
    const res = await apiFetch(
      `/api/conversations/${activeConversation.id}/star?channel=${activeConversation.channel}`,
      { method: "PATCH" }
    );
    if (res.ok) {
      const data = await res.json();
      setActiveConversation((prev) =>
        prev ? { ...prev, starred: data.starred } : null
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id ? { ...c, starred: data.starred } : c
        )
      );
    }
  }

  async function resetPersona() {
    if (!activeConversation) return;
    const yes = await confirm({
      title: t("convs.resetTitle"),
      body: t("convs.resetBody"),
      confirmLabel: t("convs.resetConfirm"),
    });
    if (!yes) return;
    const res = await apiFetch(
      `/api/conversations/${activeConversation.id}/persona-reset?channel=${activeConversation.channel}`,
      { method: "PATCH" }
    );
    if (res.ok) {
      const data = await res.json();
      setActiveConversation((prev) =>
        prev ? { ...prev, personaResetAt: data.personaResetAt } : null
      );
    } else {
      notify(t("convs.resetFailed"));
    }
  }

  const title = activeConversation ? conversationTitle(activeConversation, t) : "";
  // Every photo in the chat, oldest first, for the viewer's arrows.
  const chatPhotoIds = activeConversation
    ? activeConversation.messages.flatMap((m) => activeConversation.photos?.[m.id] ?? [])
    : [];
  const activeState = conversations.find((c) => c.id === activeConversation?.id)?.state;
  // A quote filed while the chat is open (the list refreshes on its own):
  // fetch it, so its bar appears without reopening the chat.
  const activeKind = activeState?.kind;
  useEffect(() => {
    if (activeKind === "quote" && selectedId && quote?.status !== "requested") void loadQuote(selectedId, selectedChannel);
    // Only when the chat's state turns to "quote".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKind]);
  const time = (iso: string) => format(new Date(iso), clock === "24h" ? "HH:mm" : "h:mmaaa");

  const panel = activeConversation ? (
    <ClientPanel
      key={activeConversation.id}
      conversation={activeConversation}
      state={activeState}
      title={title}
      onTakeOver={activeConversation.channel === "website" ? () => setHandoff("human") : undefined}
      onChanged={() => {
        refetchActive();
        fetchConversations(true);
      }}
      onResetPersona={isOwner ? resetPersona : undefined}
    />
  ) : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT PANEL: chats grouped by what they need (src/lib/conversation-state.ts). */}
      <aside
        className={cn(
          "flex-col bg-card border-r border-border shrink-0",
          "w-full lg:w-[22rem] xl:w-[20rem] 2xl:w-[23rem]",
          mobileView === "list" ? "flex" : "hidden lg:flex"
        )}
      >
        <div className="shrink-0 space-y-3 border-b border-border px-4 pb-3.5 pt-4">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 font-heading text-xl font-extrabold tracking-tight">{t("convs.title")}</h2>
            <button
              type="button"
              onClick={() => setFilter(filter === "starred" ? "all" : "starred")}
              aria-pressed={filter === "starred"}
              aria-label={filter === "starred" ? t("convs.showAll") : t("convs.showStarred")}
              title={filter === "starred" ? t("convs.showingStarred") : t("convs.showStarred")}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                filter === "starred"
                  ? "border-papaya-whip-300 bg-papaya-whip-600 text-papaya-whip-100"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Star className={cn("h-4 w-4", filter === "starred" && "fill-papaya-whip-300")} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (searchOpen) setSearch("");
                setSearchOpen(!searchOpen);
              }}
              aria-pressed={searchOpen}
              aria-label={searchOpen ? t("convs.closeSearch") : t("convs.search")}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                searchOpen ? "border-tea-green-500 bg-tea-green-800 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </button>
          </div>

          {searchOpen && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("convs.searchPlaceholder")}
                aria-label={t("convs.search")}
                className="h-10 rounded-xl pl-9 text-sm"
                autoFocus
              />
            </div>
          )}

          {/* Which channel. Only shown when there is a choice to make. */}
          {visibleChannelTabs.length > 2 && (
            <div role="group" aria-label={t("convs.channels")} className="flex flex-wrap gap-1.5">
              {visibleChannelTabs.map((tab) => {
                const on = channelFilter === tab.value;
                const meta = tab.value === "all" ? null : CHANNEL_META[tab.value];
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setChannelFilter(tab.value)}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
                      on
                        ? "border-primary bg-primary font-semibold text-primary-foreground"
                        : "border-border bg-card font-medium text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {meta && <span className={cn("h-2 w-2 rounded-full", meta.bg)} aria-hidden />}
                    {tab.value === "all" ? t("convs.all") : channelLabel(tab.value, t)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={
                search || filter !== "all" || channelFilter !== "all"
                  ? t("convs.nothingMatches")
                  : t("convs.none")
              }
              hint={
                search || filter !== "all" || channelFilter !== "all"
                  ? t("convs.nothingMatchesHint")
                  : t("convs.noneHint")
              }
            />
          ) : (
            groupConversations(conversations).map((group) => (
              <section key={group.id} aria-labelledby={`group-${group.id}`} className="pt-1">
                <h3
                  id={`group-${group.id}`}
                  className={cn(
                    "flex items-center gap-2 px-2.5 pb-1 pt-3 text-[11.5px] font-bold uppercase tracking-[0.07em]",
                    group.ink
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", group.dot)} aria-hidden />
                  {t(group.title)}
                  <span className="font-semibold normal-case tracking-normal text-muted-foreground">{group.rows.length}</span>
                </h3>
                <div className="space-y-0.5">
                  {group.rows.map((conv) => (
                    <ConversationListItem
                      key={`${conv.channel}-${conv.id}`}
                      id={conv.id}
                      channel={conv.channel}
                      contactName={conv.contactName}
                      phoneNumber={conv.identifier}
                      lastMessage={conv.lastMessage}
                      lastMessageAt={conv.lastMessageAt}
                      lastRole={conv.lastRole}
                      isRead={conv.isRead}
                      starred={conv.starred}
                      isActive={conv.id === selectedId}
                      profilePicUrl={conv.profilePicUrl}
                      handle={conv.handle}
                      state={conv.state}
                      onClick={() => selectConversation(conv.id, conv.channel)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </aside>

      {/* MIDDLE PANEL: the thread. The client on the left, the salon on the right.
          Until the client sits beside it (xl), its bottom bars keep clear of
          the assistant's button in the corner (md:max-xl:pr-[5.5rem]). */}
      <section
        className={cn(
          "flex-1 flex-col min-w-0 bg-background",
          mobileView === "chat" ? "flex" : "hidden lg:flex"
        )}
      >
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={MessageCircle}
              title={t("convs.select")}
              hint={t("convs.selectHint")}
            />
          </div>
        ) : loadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : activeConversation ? (
          <>
            <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 py-3 md:px-5">
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden h-8 w-8 p-0"
                onClick={() => setMobileView("list")}
                aria-label={t("convs.back")}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>

              {/* Below the widest screens the client is a tap away: on the name. */}
              <button
                type="button"
                onClick={() => setContactPanelOpen(true)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left xl:pointer-events-none"
                aria-label={t("convs.clientDetailsFor", { name: title })}
              >
                <span className="relative shrink-0">
                  <ContactAvatar
                    src={activeConversation.profilePicUrl}
                    initials={initialsFor(
                      activeConversation.contactName || activeConversation.lead?.name || null,
                      activeConversation.phoneNumber || title
                    )}
                    colourClass={avatarColorFor(title)}
                    size={40}
                    className="h-10 w-10 text-sm"
                  />
                  {CHANNEL_META[activeConversation.channel] && (
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card",
                        CHANNEL_META[activeConversation.channel].bg
                      )}
                      title={channelLabel(activeConversation.channel, t)}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold">{title}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {activeConversation.channel === "website"
                      ? activeConversation.site?.name || t("channel.website")
                      : channelLabel(activeConversation.channel, t)}
                    {" · "}
                    {t("convs.messages", { n: activeConversation.messages.length })}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={toggleStar}
                aria-pressed={activeConversation.starred}
                aria-label={activeConversation.starred ? t("convs.unstar") : t("convs.star")}
                title={activeConversation.starred ? t("convs.starred") : t("convs.starThis")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Star className={cn("h-4 w-4", activeConversation.starred && "fill-papaya-whip-300 text-papaya-whip-200")} />
              </button>
              <button
                type="button"
                onClick={() => setContactPanelOpen(true)}
                aria-label={t("convs.clientDetails")}
                title={t("convs.clientDetails")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground xl:hidden"
              >
                <UserRound className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4 md:px-6">
              {activeConversation.messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <EmptyState
                    icon={MessageCircle}
                    title={t("convs.noMessages")}
                    hint={t("convs.noMessagesHint")}
                  />
                </div>
              ) : (
                threadItems(activeConversation).map((item, i, items) => {
                  if (item.type === "event") {
                    return <EventChip key={`ev-${i}`} event={item.event} time={time} t={t} lang={lang} />;
                  }
                  const msg = item.msg;
                  const prevMsg = items.slice(0, i).reverse().find((x) => x.type === "msg");
                  const prev = items[i - 1];
                  const next = items[i + 1];
                  // A thread can span weeks: a marker at each new day.
                  const showDay =
                    !prevMsg || prevMsg.type !== "msg" || !isSameDay(prevMsg.msg.createdAt, msg.createdAt);
                  // A run is one side's messages in a row, unbroken by a day or a booking.
                  const side = (m: { role: string }) => (isUserSide(m.role) ? "client" : m.role);
                  const firstOfRun = showDay || prev?.type !== "msg" || side(prev.msg) !== side(msg);
                  const showTail =
                    next?.type !== "msg" ||
                    side(next.msg) !== side(msg) ||
                    !isSameDay(msg.createdAt, next.msg.createdAt);
                  const label = !firstOfRun
                    ? null
                    : msg.role === "user"
                      ? title.split(/\s+/)[0]
                      : msg.role === "agent"
                        ? t("convs.you")
                        : activeConversation.site?.botName || "Kikai";

                  return (
                    <div key={msg.id} className={cn(showDay && "pt-3", firstOfRun && !showDay && "pt-2.5")}>
                      {showDay && (
                        <div
                          className="flex items-center gap-3 pb-3"
                          role="separator"
                          aria-label={dayLabel(msg.createdAt, t, locale)}
                        >
                          <span className="h-px flex-1 bg-border" />
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {dayLabel(msg.createdAt, t, locale)}
                          </span>
                          <span className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <MessageBubble
                        role={msg.role}
                        content={msg.content}
                        createdAt={msg.createdAt}
                        showTail={showTail}
                        label={label}
                        photos={activeConversation.photos?.[msg.id]}
                        onOpenPhoto={setPhotoOpen}
                      />
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {selectedChannel === "website" ? (
              <div className="border-t border-border bg-card">
                <div className="flex items-center justify-between gap-3 px-4 pt-3 md:max-xl:pr-[5.5rem]">
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        activeConversation.handoffState === "human" ? "bg-violet-600" : "bg-tea-green-300"
                      )}
                    />
                    <span className="truncate">
                      {activeConversation.handoffState === "human" ? (
                        <>
                          <strong>{t("convs.youReplying")}</strong>{" "}
                          <span className="text-muted-foreground">{t("convs.kikaiPaused")}</span>
                        </>
                      ) : (
                        <>
                          <strong>{t("convs.kikaiAnswering")}</strong>{" "}
                          <span className="text-muted-foreground">{t("convs.replyingPauses")}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <Button
                    variant={activeConversation.handoffState === "human" ? "outline" : "default"}
                    size="sm"
                    disabled={switchingHandoff}
                    onClick={() => setHandoff(activeConversation.handoffState === "human" ? "bot" : "human")}
                  >
                    {activeConversation.handoffState === "human" ? t("convs.handBack") : t("convs.takeOver")}
                  </Button>
                </div>
                <form onSubmit={sendReply} className="flex gap-2 p-3 pt-2.5 md:max-xl:pr-[5.5rem]">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={
                      activeConversation.handoffState === "human"
                        ? t("convs.writeVisitor")
                        : t("convs.writeVisitorPauses")
                    }
                    aria-label={t("convs.replyLabel")}
                    disabled={replying}
                    className="h-11 flex-1 rounded-xl border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring/40 disabled:opacity-50"
                  />
                  <Button type="submit" className="h-11 px-5" disabled={replying || !reply.trim()}>
                    {replying ? t("convs.sending") : t("convs.send")}
                  </Button>
                </form>
              </div>
            ) : quote?.status === "requested" && !quoteOpen ? (
              // A client waiting for a price on their designs.
              <div className="flex items-center gap-3 border-t-[1.5px] border-papaya-whip-400 bg-card px-4 py-3 md:max-xl:pr-[5.5rem] phone:flex-col phone:items-stretch phone:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex shrink-0">
                    {quote.items.slice(0, 3).map((it) => (
                      // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image
                      <img
                        key={it.photoId}
                        src={withAsOrg(`/api/chat-photos/${it.photoId}`)}
                        alt=""
                        className="-mr-2 h-9 w-9 rounded-[9px] border-2 border-card bg-muted object-cover"
                      />
                    ))}
                  </div>
                  <p className="min-w-0 pl-2 text-[13.5px]">
                    <strong>
                      {quote.clientName
                        ? t("convs.wantsPrice", { name: quote.clientName, n: quote.items.length })
                        : t("convs.theyWantPrice", { n: quote.items.length })}
                    </strong>{" "}
                    <span className="text-muted-foreground">{t("convs.replyShortly")}</span>
                  </p>
                </div>
                <Button onClick={() => setQuoteOpen(true)} className="shrink-0 phone:h-12 phone:text-base">
                  {t("convs.quoteNow")}
                </Button>
              </div>
            ) : (
              // WhatsApp, Instagram and Messenger replies go back out through
              // their own provider APIs, which this inbox does not send to yet.
              <div className="flex items-center gap-2.5 border-t border-border bg-card px-4 py-3.5 text-[13px] text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full bg-tea-green-300" aria-hidden />
                <span>
                  <strong className="text-foreground">{t("convs.answeringOn", { channel: channelLabel(activeConversation.channel, t) })}</strong>{" "}
                  {t("convs.websiteOnly")}
                </span>
              </div>
            )}
          </>
        ) : null}
      </section>

      {/* Pricing the client's designs: beside the chat, or over it on a phone. */}
      {quoteOpen && quote?.status === "requested" && (
        <QuotePanel
          key={quote.id}
          quote={quote}
          onClose={() => setQuoteOpen(false)}
          onSent={(via) => {
            setQuoteOpen(false);
            if (selectedId) void loadQuote(selectedId, selectedChannel);
            refetchActive();
            fetchConversations(true);
            notify(
              via === "sms"
                ? t("convs.quoteSentSms")
                : t("convs.quoteSent")
            );
          }}
        />
      )}

      {/* RIGHT PANEL: the client, once there is a chat open. */}
      {panel && !(quoteOpen && quote?.status === "requested") && (
        <aside className="hidden xl:flex xl:w-[22rem] 2xl:w-96 shrink-0 flex-col border-l border-border bg-card">
          {panel}
        </aside>
      )}

      {/* Below the widest screens: the client over the chat. */}
      {contactPanelOpen && activeConversation && (
        <div className="xl:hidden fixed inset-0 z-50 flex">
          <button
            className="flex-1 bg-tea-green-100/30 backdrop-blur-[2px]"
            onClick={() => setContactPanelOpen(false)}
            aria-label={t("convs.closeClient")}
          />
          <div className="flex w-full max-w-[24rem] flex-col border-l border-border bg-card animate-in slide-in-from-right">
            <ClientPanel
              key={activeConversation.id}
              conversation={activeConversation}
              state={activeState}
              title={title}
              onTakeOver={
                activeConversation.channel === "website"
                  ? () => {
                      setContactPanelOpen(false);
                      setHandoff("human");
                    }
                  : undefined
              }
              onChanged={() => {
                refetchActive();
                fetchConversations(true);
              }}
              onResetPersona={isOwner ? resetPersona : undefined}
              onClose={() => setContactPanelOpen(false)}
            />
          </div>
        </div>
      )}

      {/* A photo the client sent, full size; the arrows step through the chat's others. */}
      <PhotoViewer
        photoIds={chatPhotoIds}
        index={photoOpen === null ? null : chatPhotoIds.indexOf(photoOpen)}
        onIndex={(i) => setPhotoOpen(chatPhotoIds[i] ?? null)}
        onClose={() => setPhotoOpen(null)}
        title={t("convs.photoFrom", { name: title })}
      />
    </div>
  );
}

/** The name a chat goes by: theirs, their lead's, or how to reach them. */
function conversationTitle(c: ConversationDetail, t: Translate): string {
  return (
    c.contactName ||
    c.lead?.name ||
    (c.handle ? `@${c.handle}` : null) ||
    c.visitorEmail ||
    c.phoneNumber ||
    t("convs.unknown")
  );
}

type ThreadItem =
  | { type: "msg"; msg: ConversationDetail["messages"][number] }
  | { type: "event"; event: ThreadEvent };

/** The messages, with what came of the chat (bookings, messages taken) at the moment it happened. */
function threadItems(c: ConversationDetail): ThreadItem[] {
  const events = [...(c.events ?? [])];
  const out: ThreadItem[] = [];
  for (const msg of c.messages) {
    while (events.length && new Date(events[0].at).getTime() < new Date(msg.createdAt).getTime()) {
      out.push({ type: "event", event: events.shift()! });
    }
    out.push({ type: "msg", msg });
  }
  for (const event of events) out.push({ type: "event", event });
  return out;
}

function EventChip({ event, time, t, lang }: { event: ThreadEvent; time: (iso: string) => string; t: Translate; lang: Lang }) {
  const booked = event.kind === "booked";
  const Icon = booked ? CalendarCheck : PhoneCall;
  const chip = cn(
    "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
    booked ? "border-tea-green-600 bg-card text-tea-green-100" : "border-papaya-whip-400 bg-papaya-whip-900 text-light-bronze-200"
  );
  const content = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {event.kind === "booked" ? (
          <>
            <strong className="font-semibold">{t("convs.eventBooked")}</strong> · {event.serviceText},{" "}
            {format(new Date(event.startsAt), "EEE d MMM", { locale: DATE_FNS_LOCALE[lang] })}, {time(event.startsAt)}
            {event.bookingNumber !== null && ` · #${event.bookingNumber}`}
          </>
        ) : (
          <>
            <strong className="font-semibold">{t("convs.eventMessage")}</strong> · {t("convs.inCallbacks")}
          </>
        )}
      </span>
    </>
  );
  return (
    <div className="flex justify-center py-2.5">
      {event.kind === "booked" ? (
        // A booking made in the chat opens itself in the diary.
        <Link
          href={withAsOrg(`/calendar?date=${event.day}&booking=${encodeURIComponent(event.id)}`)}
          className={cn(chip, "transition-colors hover:bg-tea-green-900")}
        >
          {content}
        </Link>
      ) : (
        <span className={chip}>{content}</span>
      )}
    </div>
  );
}
