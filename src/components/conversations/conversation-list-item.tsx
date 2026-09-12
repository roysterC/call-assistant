import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import {
  CHANNEL_META,
  avatarColorFor,
  initialsFor,
  type Channel as SharedChannel,
} from "@/lib/channels";

// The conversation list only ever shows non-phone channels.
type Channel = Exclude<SharedChannel, "phone">;

interface ConversationListItemProps {
  id: string;
  contactName: string | null;
  phoneNumber: string;
  lastMessage: string | null;
  lastMessageAt: string;
  isRead: boolean;
  starred: boolean;
  isActive: boolean;
  channel?: Channel;
  /** Profile-pic URL fetched from Graph API (IG/FB only). */
  profilePicUrl?: string | null;
  /** IG @username (no FB equivalent). */
  handle?: string | null;
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

export function ConversationListItem({
  contactName,
  phoneNumber,
  lastMessage,
  lastMessageAt,
  isRead,
  starred,
  isActive,
  channel,
  profilePicUrl,
  handle,
  onClick,
}: ConversationListItemProps) {
  const initials = initialsFor(contactName, phoneNumber);
  const avatarColor = avatarColorFor(contactName || phoneNumber);
  const badge = channel ? CHANNEL_META[channel] : null;
  const ChannelIcon = badge?.icon;

  // Fallback ladder for the primary display name. For IG/FB the API
  // sends phoneNumber: "" — we land on the handle (or a friendly
  // channel placeholder when even that is missing on first contact).
  const channelPlaceholder =
    channel === "instagram"
      ? "Instagram user"
      : channel === "facebook"
      ? "Messenger user"
      : channel === "website"
      ? "Visitor"
      : "Unknown";
  const primaryName =
    contactName ||
    (handle ? `@${handle}` : null) ||
    phoneNumber ||
    channelPlaceholder;
  // Only show the secondary "@handle" row if the primary line isn't
  // already showing the same handle.
  const showHandleSecondary = handle && contactName;
  // Meta CDN URLs for IG/FB profile pics expire (~24h). When the cached
  // URL 404s the Image silently shows a broken icon. Track the load
  // failure and fall back to the coloured initials avatar.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = profilePicUrl && !imgFailed;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-3 px-3 py-3 text-left transition-colors border-b border-white/5",
        isActive
          ? "bg-blue-600/15 border-l-2 border-l-blue-500"
          : "hover:bg-white/5"
      )}
    >
      <div className="relative shrink-0">
        {showImage ? (
          <Image
            src={profilePicUrl}
            alt={contactName || ""}
            width={40}
            height={40}
            className="w-10 h-10 rounded-full object-cover"
            unoptimized
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-semibold",
              avatarColor
            )}
          >
            {initials}
          </div>
        )}
        {badge && ChannelIcon && (
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border border-[#161b22]",
              badge.bg
            )}
            title={badge.label}
          >
            <ChannelIcon className="w-2.5 h-2.5 text-white" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-sm truncate",
              !isRead ? "font-semibold text-white" : "font-medium text-slate-300"
            )}
          >
            {primaryName}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatRelativeTime(lastMessageAt)}
          </span>
        </div>

        {showHandleSecondary && (
          <div className="text-[11px] text-muted-foreground truncate -mt-0.5">
            @{handle}
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-0.5">
          {!isRead && (
            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
          )}
          {starred && (
            <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
          )}
          <p
            className={cn(
              "text-xs truncate",
              !isRead ? "text-slate-300" : "text-muted-foreground"
            )}
          >
            {lastMessage || "No messages yet"}
          </p>
        </div>
      </div>
    </button>
  );
}
