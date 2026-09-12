import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  /** "agent" is a human operator reply sent from this inbox. */
  role: "user" | "assistant" | "agent";
  content: string;
  createdAt: string;
}

export function MessageBubble({ role, content, createdAt }: MessageBubbleProps) {
  const isUser = role === "user";
  const isAgent = role === "agent";

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      {/*
        Operators need to tell at a glance which replies were theirs and which
        the bot sent — otherwise a transcript reads as one voice and it is
        impossible to see where a handoff happened.
      */}
      {isAgent && (
        <span className="text-[10px] font-medium text-emerald-400 mb-0.5 px-1">
          You
        </span>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
          isUser && "bg-blue-600 text-white rounded-br-md",
          isAgent &&
            "bg-emerald-500/10 text-slate-100 border border-emerald-500/40 rounded-bl-md",
          !isUser &&
            !isAgent &&
            "bg-white/5 text-slate-200 border border-white/10 rounded-bl-md"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
        <p
          className={cn(
            "text-[10px] mt-1",
            isUser ? "text-blue-200" : "text-slate-500"
          )}
        >
          {format(new Date(createdAt), "h:mm a")}
        </p>
      </div>
    </div>
  );
}
