import Image from "next/image";
import { useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import {
  CHANNEL_META,
  avatarColorFor,
  initialsFor,
  type Channel as SharedChannel,
} from "@/lib/channels";
import type { ConversationState } from "@/lib/conversation-state";
import { useLanguage } from "@/components/providers/language-provider";

// The conversation list only ever shows non-phone channels.
type Channel = Exclude<SharedChannel, "phone">;

interface ConversationListItemProps {
  id: string;
  contactName: string | null;
  phoneNumber: string;
  lastMessage: string | null;
  lastMessageAt: string;
  /** Who sent the last message: "user" (the client), "assistant" (Kikai), "agent" (staff). */
  lastRole?: string | null;
  isRead: boolean;
  starred: boolean;
  isActive: boolean;
  channel?: Channel;
  /** Profile-pic URL fetched from Graph API (IG/FB only). */
  profilePicUrl?: string | null;
  /** IG @username (no FB equivalent). */
  handle?: string | null;
  /** Where it stands and what happened (src/lib/conversation-state.ts). */
  state?: ConversationState;
  onClick: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** "5 min", "2 hours", "3 days": how long a client has been waiting. */
function waitedFor(dateStr: string): string {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** The tag under each row: what the chat needs, or what came of it. */
const TAG_STYLE: Record<ConversationState["kind"], string> = {
  waiting: "bg-orange-100 text-orange-800",
  staff: "bg-violet-100 text-violet-800",
  replying: "bg-muted text-muted-foreground",
  bot: "bg-muted text-muted-foreground",
  booked: "bg-tea-green-800 text-tea-green-100",
  message: "bg-papaya-whip-600 text-light-bronze-200",
  replied: "bg-muted text-muted-foreground",
};

export function ConversationListItem({
  contactName,
  phoneNumber,
  lastMessage,
  lastMessageAt,
  lastRole,
  isRead,
  starred,
  isActive,
  channel,
  profilePicUrl,
  handle,
  state,
  onClick,
}: ConversationListItemProps) {
  const { clock } = useLanguage();
  const initials = initialsFor(contactName, phoneNumber);
  const avatarColor = avatarColorFor(contactName || phoneNumber);
  const badge = channel ? CHANNEL_META[channel] : null;
  const ChannelIcon = badge?.icon;

  // Fallback ladder for the primary display name. For IG/FB the API
  // sends phoneNumber: "" — we land on the handle (or a friendly
  // channel placeholder when even that is missing on first contact).
  // Website is absent deliberately: that channel's identifier is now always
  // populated upstream (websiteVisitorLabel), so a "Visitor" branch here could
  // never be reached — it looked like a safety net while being dead code.
  const channelPlaceholder =
    channel === "instagram"
      ? "Instagram user"
      : channel === "facebook"
      ? "Messenger user"
      : "Unknown";
  const primaryName =
    contactName ||
    (handle ? `@${handle}` : null) ||
    phoneNumber ||
    channelPlaceholder;
  // Meta CDN URLs for IG/FB profile pics expire (~24h). When the cached
  // URL 404s the Image silently shows a broken icon. Track the load
  // failure and fall back to the coloured initials avatar.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = profilePicUrl && !imgFailed;

  // Who spoke last, so "The earliest is tomorrow…" reads as Kikai's words.
  const speaker = lastRole === "assistant" ? "Kikai: " : lastRole === "agent" ? "You: " : "";

  const tag = state ? tagText(state, lastMessageAt, clock) : null;
  const waiting = state?.kind === "waiting";

  return (
    <button
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "w-full flex items-start gap-3 rounded-2xl px-2.5 py-3 text-left transition-colors",
        isActive ? "bg-tea-green-800 ring-1 ring-inset ring-tea-green-500" : "hover:bg-tea-green-900"
      )}
    >
      <div className="relative shrink-0">
        {showImage ? (
          <Image
            src={profilePicUrl}
            alt={contactName || ""}
            width={42}
            height={42}
            className="h-[42px] w-[42px] rounded-full object-cover"
            unoptimized
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className={cn(
              "h-[42px] w-[42px] rounded-full flex items-center justify-center text-sm font-semibold",
              avatarColor
            )}
          >
            {initials}
          </div>
        )}
        {badge && ChannelIcon && (
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-[18px] w-[18px] rounded-full flex items-center justify-center border-2 border-card",
              badge.bg
            )}
            title={badge.label}
          >
            <ChannelIcon className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className={cn("min-w-0 truncate text-[15px]", !isRead ? "font-bold" : "font-semibold")}>
            {primaryName}
          </span>
          {starred && (
            <Star className="h-3.5 w-3.5 shrink-0 self-center fill-papaya-whip-300 text-papaya-whip-200" aria-label="Starred" />
          )}
          <span
            className={cn(
              "ml-auto shrink-0 text-xs font-semibold tabular-nums",
              waiting ? "text-orange-700" : "text-muted-foreground"
            )}
          >
            {formatRelativeTime(lastMessageAt)}
          </span>
        </div>

        <p className={cn("truncate text-[13.5px] leading-snug", !isRead ? "text-foreground" : "text-muted-foreground")}>
          {speaker && <span className="text-muted-foreground">{speaker}</span>}
          {lastMessage || "No messages yet"}
        </p>

        {(tag || !isRead) && (
          <div className="flex items-center gap-2 pt-1">
            {tag && (
              <span
                className={cn(
                  "inline-flex h-[22px] max-w-full items-center truncate rounded-full px-2 text-[11.5px] font-semibold",
                  TAG_STYLE[state!.kind]
                )}
              >
                {tag}
              </span>
            )}
            {!isRead && <span className="shrink-0 text-[11.5px] font-semibold text-tea-green-200">New</span>}
          </div>
        )}
      </div>
    </button>
  );
}

function tagText(state: ConversationState, lastMessageAt: string, clock: "12h" | "24h"): string {
  switch (state.kind) {
    case "waiting":
      return `Waiting for you · ${waitedFor(lastMessageAt)}`;
    case "staff":
      return "You took over from Kikai";
    case "replying":
      return "Kikai is replying";
    case "bot":
      return "Kikai replied";
    case "booked": {
      if (!state.booking) return "Booked";
      const at = new Date(state.booking.startsAt);
      const when = format(at, clock === "24h" ? "EEE d MMM, HH:mm" : "EEE d MMM, h:mmaaa");
      return `Booked · ${state.booking.service}, ${when}`;
    }
    case "message":
      return "Message taken · in Callbacks";
    case "replied":
      return "You replied";
  }
}
