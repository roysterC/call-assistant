import { format } from "date-fns";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { withAsOrg } from "@/lib/api-fetch";
import { readPhotoLine } from "@/lib/thread-photos";
import { useLanguage } from "@/components/providers/language-provider";

interface MessageBubbleProps {
  /** "user" is the client; "assistant" is Kikai; "agent" is staff replying from this inbox. */
  role: "user" | "assistant" | "agent";
  content: string;
  createdAt: string;
  /**
   * False when the next message is from the same side, so a run of
   * replies reads as one turn instead of a stack of separate cards.
   */
  showTail?: boolean;
  /** Who is speaking, over the first message of a run: "Mai", "Kikai", "You". */
  label?: string | null;
  /** Ids of the photos this message carried (/api/chat-photos/[id]). */
  photos?: string[];
  onOpenPhoto?: (id: string) => void;
}

/**
 * One message. The client on the left, the salon on the right (Kikai, and
 * staff in a darker green), as in the chat apps the client wrote from.
 */
export function MessageBubble({
  role,
  content,
  createdAt,
  showTail = true,
  label,
  photos = [],
  onOpenPhoto,
}: MessageBubbleProps) {
  const { clock } = useLanguage();
  const isClient = role === "user";
  const isAgent = role === "agent";
  const photo = isClient ? readPhotoLine(content) : null;
  const text = photo?.isPhoto ? photo.caption : content;
  const time = format(new Date(createdAt), clock === "24h" ? "HH:mm" : "h:mmaaa");

  return (
    <div className={cn("flex flex-col gap-1", isClient ? "items-start" : "items-end")}>
      {label && (
        <span
          className={cn(
            "px-1 text-[11.5px] font-semibold",
            isClient ? "text-muted-foreground" : isAgent ? "text-foreground" : "text-tea-green-200"
          )}
        >
          {label}
        </span>
      )}

      {photo?.isPhoto && photos.length > 0 && (
        <div className={cn("flex max-w-[min(75%,52ch)] flex-wrap gap-1.5", !isClient && "justify-end")}>
          {photos.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => onOpenPhoto?.(id)}
              className="block cursor-zoom-in overflow-hidden rounded-2xl rounded-bl-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              aria-label={photos.length > 1 ? `See photo ${i + 1} full size` : "See the photo full size"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image */}
              <img
                src={withAsOrg(`/api/chat-photos/${id}`)}
                alt={text ? `Photo: ${text}` : "Photo the client sent"}
                className={cn("block object-cover", photos.length > 1 ? "h-32 w-32" : "h-44 w-56")}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {photo?.isPhoto && photos.length === 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          <ImageOff className="h-3.5 w-3.5" aria-hidden />
          {photo.saved ? "Sent a photo" : "Sent a photo that couldn't be saved"}
        </span>
      )}

      {(text || !photo?.isPhoto) && (
        <div
          className={cn(
            // Whichever is smaller: the percentage keeps it off the far edge
            // on a narrow pane, the measure keeps lines readable on a wide one.
            "max-w-[min(75%,52ch)] rounded-2xl px-4 py-2.5 text-sm",
            isClient && "border border-border bg-card text-foreground",
            isClient && (showTail ? "rounded-bl-md" : ""),
            !isClient && !isAgent && "border border-tea-green-700 bg-tea-green-800 text-foreground",
            isAgent && "bg-primary text-primary-foreground",
            !isClient && (showTail ? "rounded-br-md" : "")
          )}
        >
          <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>
          <p
            className={cn(
              "mt-1 text-right text-[10.5px] tabular-nums",
              isAgent ? "text-primary-foreground/75" : "text-muted-foreground"
            )}
          >
            {time}
          </p>
        </div>
      )}
      {photo?.isPhoto && !text && (
        <span className="px-1 text-[10.5px] tabular-nums text-muted-foreground">{time}</span>
      )}
    </div>
  );
}
