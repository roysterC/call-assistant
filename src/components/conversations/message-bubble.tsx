import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  /** "agent" is a human operator reply sent from this inbox. */
  role: "user" | "assistant" | "agent";
  content: string;
  createdAt: string;
  /**
   * False when the previous message was from the same side, so a run of
   * replies reads as one turn instead of a stack of separate cards.
   */
  showTail?: boolean;
}

export function MessageBubble({
  role,
  content,
  createdAt,
  showTail = true,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const isAgent = role === "agent";

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      {/*
        Operators need to tell at a glance which replies were theirs and which
        the bot sent — otherwise a transcript reads as one voice and it is
        impossible to see where a handoff happened.
      */}
      {isAgent && showTail && (
        <span className="text-[10px] font-medium text-emerald-400 mb-0.5 px-1">
          You
        </span>
      )}
      <div
        className={cn(
          // Whichever is smaller. The percentage keeps the bubble off the far
          // edge on a narrow pane; the character measure stops a long reply
          // running to 90-odd characters a line on a wide one, which is well
          // past readable and was how every bot answer rendered.
          //
          // min() rather than two classes: max-w and max-inline-size are the
          // same property, so declaring both does not apply both — the later
          // one in the generated CSS simply wins, and the percentage was being
          // dropped.
          "max-w-[min(75%,52ch)] rounded-2xl px-4 py-2.5 text-sm",
          isUser && "bg-blue-600 text-white",
          isUser && (showTail ? "rounded-br-md" : "rounded-br-2xl"),
          isAgent &&
            "bg-emerald-500/10 text-foreground border border-emerald-500/40",
          // The bot's bubble was bg-white/5 — barely a shade off the pane
          // behind it, so replies read as loose text rather than messages.
          !isUser && !isAgent && "bg-muted text-foreground border border-border",
          !isUser && (showTail ? "rounded-bl-md" : "rounded-bl-2xl")
        )}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </p>
        <p
          className={cn(
            "text-[10px] mt-1 tabular-nums",
            isUser ? "text-blue-100/80" : "text-muted-foreground"
          )}
        >
          {format(new Date(createdAt), "HH:mm")}
        </p>
      </div>
    </div>
  );
}
