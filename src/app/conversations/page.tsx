"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
import type { Channel, ConversationDetail, ThreadEvent } from "@/components/conversations/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { withAsOrg } from "@/lib/api-fetch";
import { useLanguage } from "@/components/providers/language-provider";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { CHANNEL_META, avatarColorFor, initialsFor } from "@/lib/channels";
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
const GROUPS: { id: ConversationGroup; title: string; dot: string; ink: string }[] = [
  { id: "you", title: "Needs you", dot: "bg-orange-600", ink: "text-orange-800" },
  { id: "bot", title: "Kikai is handling", dot: "bg-tea-green-300", ink: "text-tea-green-200" },
  { id: "done", title: "Done", dot: "bg-tea-green-500", ink: "text-muted-foreground" },
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
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(dateStr, today.toISOString())) return "Today";
  if (isSameDay(dateStr, yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    // A year only when it isn't this one — "12 Sep" is enough until it isn't.
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

type Filter = "all" | "unread" | "recent" | "starred";
type ChannelFilter = "all" | "whatsapp" | "website" | "instagram" | "facebook";


const CHANNEL_TABS: { value: ChannelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Messenger" },
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
  const { clock } = useLanguage();
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
        notify("Couldn't switch who is answering. Try again.");
      } finally {
        setSwitchingHandoff(false);
      }
    },
    [selectedId, selectedChannel, switchingHandoff, refetchActive, notify]
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
        notify("Your reply didn't send. Try again.");
      } finally {
        setReplying(false);
      }
    },
    [reply, selectedId, selectedChannel, replying, refetchActive, notify]
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages]);

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
      title: "Start the bot afresh on this conversation?",
      body: "Its next replies ignore earlier messages and follow the current instructions. The customer's history stays visible here.",
      confirmLabel: "Start afresh",
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
      notify("Couldn't restart the bot on this conversation. Try again.");
    }
  }

  const title = activeConversation ? conversationTitle(activeConversation) : "";
  const activeState = conversations.find((c) => c.id === activeConversation?.id)?.state;
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
          "w-full md:w-80 lg:w-[22rem] xl:w-[23rem]",
          mobileView === "list" ? "flex" : "hidden md:flex"
        )}
      >
        <div className="shrink-0 space-y-3 border-b border-border px-4 pb-3.5 pt-4">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 font-heading text-xl font-extrabold tracking-tight">Conversations</h2>
            <button
              type="button"
              onClick={() => setFilter(filter === "starred" ? "all" : "starred")}
              aria-pressed={filter === "starred"}
              aria-label={filter === "starred" ? "Show all conversations" : "Show starred only"}
              title={filter === "starred" ? "Showing starred: show all" : "Show starred only"}
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
              aria-label={searchOpen ? "Close search" : "Search conversations"}
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
                placeholder="Search names, numbers or messages"
                aria-label="Search conversations"
                className="h-10 rounded-xl pl-9 text-sm"
                autoFocus
              />
            </div>
          )}

          {/* Which channel. Only shown when there is a choice to make. */}
          {visibleChannelTabs.length > 2 && (
            <div role="group" aria-label="Channels" className="flex flex-wrap gap-1.5">
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
                    {tab.label}
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
                  ? "Nothing matches"
                  : "No conversations yet"
              }
              hint={
                search || filter !== "all" || channelFilter !== "all"
                  ? "Try a different search or clear the filters."
                  : "Chats from your website and connected channels land here."
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
                  {group.title}
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

      {/* MIDDLE PANEL: the thread. The client on the left, the salon on the right. */}
      <section
        className={cn(
          "flex-1 flex-col min-w-0 bg-background",
          mobileView === "chat" ? "flex" : "hidden md:flex"
        )}
      >
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={MessageCircle}
              title="Select a conversation"
              hint="Pick someone from the list to read the thread and reply."
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
                className="md:hidden h-8 w-8 p-0"
                onClick={() => setMobileView("list")}
                aria-label="Back to conversations"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>

              {/* Below the widest screens the client is a tap away: on the name. */}
              <button
                type="button"
                onClick={() => setContactPanelOpen(true)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left xl:pointer-events-none"
                aria-label={`${title}: client details`}
              >
                <span className="relative shrink-0">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold",
                      avatarColorFor(title)
                    )}
                  >
                    {initialsFor(
                      activeConversation.contactName || activeConversation.lead?.name || null,
                      activeConversation.phoneNumber || title
                    )}
                  </span>
                  {CHANNEL_META[activeConversation.channel] && (
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card",
                        CHANNEL_META[activeConversation.channel].bg
                      )}
                      title={CHANNEL_META[activeConversation.channel].label}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold">{title}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {activeConversation.channel === "website"
                      ? activeConversation.site?.name || "Website chat"
                      : CHANNEL_META[activeConversation.channel]?.label}
                    {" · "}
                    {activeConversation.messages.length === 1
                      ? "1 message"
                      : `${activeConversation.messages.length} messages`}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={toggleStar}
                aria-pressed={activeConversation.starred}
                aria-label={activeConversation.starred ? "Unstar" : "Star"}
                title={activeConversation.starred ? "Starred" : "Star this conversation"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Star className={cn("h-4 w-4", activeConversation.starred && "fill-papaya-whip-300 text-papaya-whip-200")} />
              </button>
              <button
                type="button"
                onClick={() => setContactPanelOpen(true)}
                aria-label="Client details"
                title="Client details"
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
                    title="No messages yet"
                    hint="Nothing has been said in this conversation."
                  />
                </div>
              ) : (
                threadItems(activeConversation).map((item, i, items) => {
                  if (item.type === "event") {
                    return <EventChip key={`ev-${i}`} event={item.event} time={time} />;
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
                        ? "You"
                        : activeConversation.site?.botName || "Kikai";

                  return (
                    <div key={msg.id} className={cn(showDay && "pt-3", firstOfRun && !showDay && "pt-2.5")}>
                      {showDay && (
                        <div
                          className="flex items-center gap-3 pb-3"
                          role="separator"
                          aria-label={dayLabel(msg.createdAt)}
                        >
                          <span className="h-px flex-1 bg-border" />
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {dayLabel(msg.createdAt)}
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
                <div className="flex items-center justify-between gap-3 px-4 pt-3">
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
                          <strong>You&apos;re replying.</strong>{" "}
                          <span className="text-muted-foreground">Kikai is paused in this chat.</span>
                        </>
                      ) : (
                        <>
                          <strong>Kikai is answering.</strong>{" "}
                          <span className="text-muted-foreground">Replying pauses it.</span>
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
                    {activeConversation.handoffState === "human" ? "Hand back to Kikai" : "Take over"}
                  </Button>
                </div>
                <form onSubmit={sendReply} className="flex gap-2 p-3 pt-2.5">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={
                      activeConversation.handoffState === "human"
                        ? "Write to the visitor"
                        : "Write to the visitor (this pauses Kikai)"
                    }
                    aria-label="Reply to this conversation"
                    disabled={replying}
                    className="h-11 flex-1 rounded-xl border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring/40 disabled:opacity-50"
                  />
                  <Button type="submit" className="h-11 px-5" disabled={replying || !reply.trim()}>
                    {replying ? "Sending…" : "Send"}
                  </Button>
                </form>
              </div>
            ) : (
              // WhatsApp, Instagram and Messenger replies go back out through
              // their own provider APIs, which this inbox does not send to yet.
              <div className="flex items-center gap-2.5 border-t border-border bg-card px-4 py-3.5 text-[13px] text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full bg-tea-green-300" aria-hidden />
                <span>
                  <strong className="text-foreground">Kikai is answering on {CHANNEL_META[activeConversation.channel]?.label}.</strong>{" "}
                  Replying from here works on website chats for now.
                </span>
              </div>
            )}
          </>
        ) : null}
      </section>

      {/* RIGHT PANEL: the client, once there is a chat open. */}
      {panel && (
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
            aria-label="Close client details"
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

      {/* A photo the client sent, full size. */}
      <Dialog open={photoOpen !== null} onOpenChange={(open) => !open && setPhotoOpen(null)}>
        <DialogContent className="max-w-[min(92vw,44rem)] p-2 sm:max-w-[min(92vw,44rem)]">
          <DialogTitle className="sr-only">Photo from {title}</DialogTitle>
          {photoOpen && (
            // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image
            <img
              src={withAsOrg(`/api/chat-photos/${photoOpen}`)}
              alt={`Photo from ${title}`}
              className="max-h-[80vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The name a chat goes by: theirs, their lead's, or how to reach them. */
function conversationTitle(c: ConversationDetail): string {
  return (
    c.contactName ||
    c.lead?.name ||
    (c.handle ? `@${c.handle}` : null) ||
    c.visitorEmail ||
    c.phoneNumber ||
    "Unknown"
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

function EventChip({ event, time }: { event: ThreadEvent; time: (iso: string) => string }) {
  const booked = event.kind === "booked";
  const Icon = booked ? CalendarCheck : PhoneCall;
  return (
    <div className="flex justify-center py-2.5">
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
          booked ? "border-tea-green-600 bg-card text-tea-green-100" : "border-papaya-whip-400 bg-papaya-whip-900 text-light-bronze-200"
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {booked ? (
            <>
              <strong className="font-semibold">Booked</strong> · {event.serviceText},{" "}
              {format(new Date(event.startsAt), "EEE d MMM")}, {time(event.startsAt)}
              {event.bookingNumber !== null && ` · #${event.bookingNumber}`}
            </>
          ) : (
            <>
              <strong className="font-semibold">Message taken</strong> · in Callbacks
            </>
          )}
        </span>
      </span>
    </div>
  );
}
