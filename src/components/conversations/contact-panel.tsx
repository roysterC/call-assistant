import Image from "next/image";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Star, Phone, Mail, Building2, Calendar, MessageCircle, AtSign, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { avatarColorFor, initialsFor } from "@/lib/channels";
import { leadStatus, STATUS_BADGE } from "@/lib/status-styles";

interface ContactPanelProps {
  conversation: {
    id: string;
    phoneNumber: string;
    contactName: string | null;
    status: string;
    starred: boolean;
    createdAt: string;
    /** Profile-pic URL fetched from Graph API (IG/FB only). */
    profilePicUrl?: string | null;
    /** IG @username (no FB equivalent). */
    handle?: string | null;
    lead: {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
      /** One-line summary of what they want. See the Lead Info section. */
      issue: string | null;
      status: string;
      source: string;
    } | null;
    /** ISO timestamp of the last persona reset, or null if never reset. */
    personaResetAt?: string | null;
  };
  onToggleStar: () => void;
  /** Triggered by the "Reset persona" button in the AI section. */
  onResetPersona: () => void;
}

export function ContactPanel({
  conversation,
  onToggleStar,
  onResetPersona,
}: ContactPanelProps) {
  const nameForDisplay =
    conversation.contactName || conversation.lead?.name || null;
  // Fallback ladder: real name → @handle (IG) → phone (WA) → "—".
  // Prevents the panel from showing an empty header for fresh IG/FB
  // contacts whose Graph profile fetch hasn't completed yet.
  const displayName =
    nameForDisplay ||
    (conversation.handle ? `@${conversation.handle}` : null) ||
    conversation.phoneNumber ||
    "—";
  const initialsSeed =
    nameForDisplay || conversation.handle || conversation.phoneNumber;
  const initials = initialsFor(nameForDisplay, initialsSeed);
  const avatarColor = avatarColorFor(initialsSeed);
  // Same fallback story as conversation-list-item: Meta CDN URLs expire,
  // so detect load failure and render the coloured initials avatar.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = conversation.profilePicUrl && !imgFailed;

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="p-4 flex flex-col items-center text-center border-b border-border">
        {showImage ? (
          <Image
            src={conversation.profilePicUrl!}
            alt={displayName}
            width={64}
            height={64}
            className="w-16 h-16 rounded-full object-cover mb-3"
            unoptimized
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-semibold mb-3",
              avatarColor
            )}
          >
            {initials}
          </div>
        )}
        {/*
          Name and status only. The handle and phone number that used to sit
          here are listed again, with icons, in the Contact block immediately
          below — the panel opened by telling you the same two things twice.
        */}
        <h3 className="font-semibold text-foreground">{displayName}</h3>

        <div className="flex items-center gap-2 mt-3">
          <Badge
            variant={
              conversation.status === "active" ? "default" : "secondary"
            }
            className="text-[10px]"
          >
            {conversation.status}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onToggleStar}
          >
            <Star
              className={cn(
                "w-4 h-4",
                conversation.starred
                  ? "text-amber-500 fill-amber-500"
                  : "text-muted-foreground"
              )}
            />
          </Button>
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Contact
          </h4>
          <div className="space-y-2.5">
            {conversation.handle && (
              <div className="flex items-center gap-2.5 text-sm">
                <AtSign className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground/80">{conversation.handle}</span>
              </div>
            )}
            {conversation.phoneNumber && (
              <div className="flex items-center gap-2.5 text-sm">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground/80">
                  {conversation.phoneNumber}
                </span>
              </div>
            )}
            {conversation.lead?.email && (
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground/80">
                  {conversation.lead.email}
                </span>
              </div>
            )}
            {conversation.lead?.company && (
              <div className="flex items-center gap-2.5 text-sm">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground/80">
                  {conversation.lead.company}
                </span>
              </div>
            )}
          </div>
        </div>

        <Separator className="bg-border" />

        {conversation.lead && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Lead info
            </h4>
            <div className="space-y-2.5">
              {/*
                What they actually want, in the panel next to the transcript.
                It was only on the leads table, so answering "what is this
                person after" meant leaving the conversation to go and look —
                or reading the thread back. Full text rather than truncated:
                it is capped at 500 characters at the point it is written, and
                this column has the room.
              */}
              {conversation.lead.issue && (
                <div className="text-sm">
                  <span className="text-muted-foreground block mb-1">
                    Issue
                  </span>
                  <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                    {conversation.lead.issue}
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                {(() => {
                  const s = leadStatus(conversation.lead.status);
                  return (
                    <span className={cn(STATUS_BADGE, s.className)}>
                      {s.label}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Source</span>
                <span className="text-foreground/80 flex items-center gap-1.5">
                  <MessageCircle className="w-3 h-3" />
                  {conversation.lead.source}
                </span>
              </div>
            </div>
          </div>
        )}

        <Separator className="bg-border" />

        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Activity
          </h4>
          <div className="flex items-center gap-2.5 text-sm">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-foreground/80">
              Joined {format(new Date(conversation.createdAt), "MMM d, yyyy")}
            </span>
          </div>
        </div>

        <Separator className="bg-border" />

        {/* AI controls — manual override for the bot's behaviour on this
            conversation. Reset persona = ignore everything before NOW
            when generating future replies (used after the org changes
            its system prompt and wants old conversations to switch
            cleanly to the new persona). */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            AI
          </h4>
          <Button
            variant="outline"
            size="sm"
            onClick={onResetPersona}
            className="w-full justify-start gap-2 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset persona
          </Button>
          {conversation.personaResetAt && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Last reset{" "}
              {format(new Date(conversation.personaResetAt), "MMM d, h:mm a")}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1.5">
            The bot will ignore messages before the reset point when
            generating new replies. Customer history stays visible here.
          </p>
        </div>
      </div>
    </div>
  );
}
