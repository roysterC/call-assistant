"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  MessageCircle,
  Search,
  ArrowLeft,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationListItem } from "@/components/conversations/conversation-list-item";
import { ContactPanel } from "@/components/conversations/contact-panel";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { apiFetch } from "@/lib/api-fetch";
import { EmptyState } from "@/components/ui/empty-state";

type Channel = "whatsapp" | "website" | "instagram" | "facebook";

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
}

interface DetailMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  channel: Channel;
  contactName: string | null;
  phoneNumber: string;
  visitorEmail?: string | null;
  visitorPhone?: string | null;
  status: string;
  isRead: boolean;
  starred: boolean;
  createdAt: string;
  lastMessageAt: string;
  userAgent?: string | null;
  referrer?: string | null;
  site?: { name: string; siteId: string; botName: string } | null;
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string;
    company: string | null;
    status: string;
    source: string;
  } | null;
  messages: DetailMessage[];
  profilePicUrl?: string | null;
  handle?: string | null;
  /** ISO timestamp of the last persona reset, or null if never reset. */
  personaResetAt?: string | null;
  /** "bot" | "requested" | "human" — website conversations only. */
  handoffState?: string;
}

type Filter = "all" | "unread" | "recent" | "starred";
type ChannelFilter = "all" | "whatsapp" | "website" | "instagram" | "facebook";

const FILTER_TABS: { value: Filter; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "recent", label: "Recent" },
  { value: "starred", label: "Starred" },
  { value: "all", label: "All" },
];

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
        alert("Failed to change handoff state");
      } finally {
        setSwitchingHandoff(false);
      }
    },
    [selectedId, selectedChannel, switchingHandoff, refetchActive]
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
        alert("Failed to send reply");
      } finally {
        setReplying(false);
      }
    },
    [reply, selectedId, selectedChannel, replying, refetchActive]
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
    if (
      !confirm(
        "Reset the AI persona on this conversation? Future replies will ignore earlier messages, so the bot will start fresh with the current system prompt. The customer's history stays visible in this view."
      )
    ) {
      return;
    }
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
      alert("Failed to reset persona. Please try again.");
    }
  }

  // For the ContactPanel we need to adapt the website shape to what the panel expects
  const contactPanelData = activeConversation
    ? {
        id: activeConversation.id,
        phoneNumber:
          activeConversation.phoneNumber ||
          activeConversation.visitorPhone ||
          activeConversation.visitorEmail ||
          "",
        contactName: activeConversation.contactName,
        status: activeConversation.status,
        starred: activeConversation.starred,
        createdAt: activeConversation.createdAt,
        lead: activeConversation.lead,
        profilePicUrl: activeConversation.profilePicUrl,
        handle: activeConversation.handle,
        personaResetAt: activeConversation.personaResetAt,
      }
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT PANEL */}
      <aside
        className={cn(
          "flex-col bg-card border-r border-border shrink-0",
          "w-full md:w-72 lg:w-80 xl:w-[22rem]",
          mobileView === "list" ? "flex" : "hidden md:flex"
        )}
      >
        <div className="p-3 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm mb-3">Conversations</h2>

          {/* Channel tabs */}
          <div className="flex gap-1 mb-2">
            {visibleChannelTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setChannelFilter(tab.value)}
                className={cn(
                  "flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                  channelFilter === tab.value
                    ? "bg-white/10 text-white"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mb-3 flex-wrap">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  filter === tab.value
                    ? "bg-blue-600/20 text-blue-400"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="pl-8 h-8 text-xs bg-white/5 border-border"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <MessageCircle className="w-6 h-6 text-slate-600 mb-2" />
              <p className="text-xs text-muted-foreground">No conversations found</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationListItem
                key={`${conv.channel}-${conv.id}`}
                id={conv.id}
                channel={conv.channel}
                contactName={conv.contactName}
                phoneNumber={conv.identifier}
                lastMessage={conv.lastMessage}
                lastMessageAt={conv.lastMessageAt}
                isRead={conv.isRead}
                starred={conv.starred}
                isActive={conv.id === selectedId}
                profilePicUrl={conv.profilePicUrl}
                handle={conv.handle}
                onClick={() => selectConversation(conv.id, conv.channel)}
              />
            ))
          )}
        </div>
      </aside>

      {/* MIDDLE PANEL */}
      <section
        className={cn(
          "flex-1 flex-col min-w-0",
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
            <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : activeConversation ? (
          <>
            <header className="px-3 md:px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden h-8 w-8 p-0"
                onClick={() => setMobileView("list")}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>

              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">
                  {activeConversation.contactName ||
                    activeConversation.lead?.name ||
                    activeConversation.visitorEmail ||
                    activeConversation.phoneNumber ||
                    "Unknown"}
                </h3>
                <p className="text-[11px] text-muted-foreground truncate">
                  {activeConversation.channel === "website"
                    ? activeConversation.site?.name || "Website"
                    : activeConversation.phoneNumber}
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="xl:hidden h-8 w-8 p-0"
                onClick={() => setContactPanelOpen(true)}
                title="Contact details"
              >
                <User className="w-4 h-4" />
              </Button>
            </header>

            <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3">
              {activeConversation.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <MessageCircle className="w-6 h-6 text-slate-600 mb-2" />
                  <p className="text-xs text-muted-foreground">
                    No messages yet in this conversation.
                  </p>
                </div>
              ) : (
                activeConversation.messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    createdAt={msg.createdAt}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/*
              Operator composer. Website only — WhatsApp, Instagram and
              Facebook replies have to go back out through their own provider
              APIs rather than just being written to the transcript, so they
              are a separate piece of work rather than a disabled-looking box
              that silently does nothing.
            */}
            {selectedChannel === "website" && (
              <div className="border-t border-border px-3 pt-2 flex items-center justify-between gap-3 bg-card">
                <span className="text-xs text-muted-foreground">
                  {activeConversation.handoffState === "human"
                    ? "You are handling this conversation. The bot is paused."
                    : activeConversation.handoffState === "requested"
                    ? "Visitor asked for a person. The bot is paused."
                    : "The bot is answering this conversation."}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={switchingHandoff}
                  onClick={() =>
                    setHandoff(
                      activeConversation.handoffState === "bot"
                        ? "human"
                        : "bot"
                    )
                  }
                >
                  {activeConversation.handoffState === "bot"
                    ? "Take over"
                    : "Hand back to bot"}
                </Button>
              </div>
            )}

            {selectedChannel === "website" && (
              <form
                onSubmit={sendReply}
                className="border-t border-border p-3 flex gap-2 bg-card"
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply as a team member..."
                  aria-label="Reply to this conversation"
                  disabled={replying}
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
                />
                <Button type="submit" size="sm" disabled={replying || !reply.trim()}>
                  {replying ? "Sending..." : "Send"}
                </Button>
              </form>
            )}
          </>
        ) : null}
      </section>

      {/*
        RIGHT PANEL — only once there is a contact to show.

        It used to render "No contact selected" beside the message pane's
        "Select a conversation": two empty states, side by side, saying the same
        thing twice, which made the screen read as half-broken rather than
        simply idle. One prompt, in the pane the eye goes to first.
      */}
      {contactPanelData && (
        <aside className="hidden xl:flex xl:flex-col xl:w-80 2xl:w-96 border-l border-border bg-card shrink-0">
          <ContactPanel
            conversation={contactPanelData}
            onToggleStar={toggleStar}
            onResetPersona={resetPersona}
          />
        </aside>
      )}

      {/* Contact panel slide-over */}
      {contactPanelOpen && contactPanelData && (
        <div className="xl:hidden fixed inset-0 z-50 flex">
          <button
            className="flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setContactPanelOpen(false)}
            aria-label="Close contact panel"
          />
          <div className="w-80 max-w-[85vw] bg-card border-l border-border flex flex-col animate-in slide-in-from-right">
            <div className="px-3 py-2.5 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-sm">Contact Details</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setContactPanelOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ContactPanel
                conversation={contactPanelData}
                onToggleStar={toggleStar}
                onResetPersona={resetPersona}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
