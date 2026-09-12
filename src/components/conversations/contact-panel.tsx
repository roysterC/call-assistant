import Image from "next/image";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Star, Phone, Mail, Building2, Calendar, MessageCircle, AtSign, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { avatarColorFor, initialsFor } from "@/lib/channels";

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
      phone: string;
      company: string | null;
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
        <h3 className="font-semibold text-white">{displayName}</h3>
        {conversation.handle && (
          <p className="text-xs text-muted-foreground mt-0.5">
            @{conversation.handle}
          </p>
        )}
        {conversation.phoneNumber && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {conversation.phoneNumber}
          </p>
        )}

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
                <span className="text-slate-300">{conversation.handle}</span>
              </div>
            )}
            {conversation.phoneNumber && (
              <div className="flex items-center gap-2.5 text-sm">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-slate-300">
                  {conversation.phoneNumber}
                </span>
              </div>
            )}
            {conversation.lead?.email && (
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-slate-300">
                  {conversation.lead.email}
                </span>
              </div>
            )}
            {conversation.lead?.company && (
              <div className="flex items-center gap-2.5 text-sm">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-slate-300">
                  {conversation.lead.company}
                </span>
              </div>
            )}
          </div>
        </div>

        <Separator className="bg-white/10" />

        {conversation.lead && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Lead Info
            </h4>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="outline" className="text-[10px]">
                  {conversation.lead.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Source</span>
                <span className="text-slate-300 flex items-center gap-1.5">
                  <MessageCircle className="w-3 h-3" />
                  {conversation.lead.source}
                </span>
              </div>
            </div>
          </div>
        )}

        <Separator className="bg-white/10" />

        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Activity
          </h4>
          <div className="flex items-center gap-2.5 text-sm">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-slate-300">
              Joined {format(new Date(conversation.createdAt), "MMM d, yyyy")}
            </span>
          </div>
        </div>

        <Separator className="bg-white/10" />

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
