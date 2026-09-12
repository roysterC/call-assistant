"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import {
  CHANNEL_META,
  avatarColorFor,
  initialsFor,
  type Channel,
} from "@/lib/channels";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { leadStatus, STATUS_BADGE } from "@/lib/status-styles";

interface SocialContact {
  channel: "instagram" | "facebook";
  externalUserId: string;
  contactName: string | null;
  handle: string | null;
  profilePicUrl: string | null;
}

interface WhatsAppContact {
  waId: string;
  contactName: string | null;
}

interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  company: string | null;
  issue: string | null;
  status: string;
  source: string;
  createdAt: string;
  _count: { calls: number; callbacks: number };
  socialContact: SocialContact | null;
  whatsappContact: WhatsAppContact | null;
}

// Source values stored on Lead → Channel union used by CHANNEL_META.
function sourceToChannel(source: string): Channel {
  switch (source) {
    case "whatsapp":
      return "whatsapp";
    case "website":
      return "website";
    case "instagram":
      return "instagram";
    case "facebook":
      return "facebook";
    case "phone":
    case "manual":
    default:
      return "phone";
  }
}

/**
 * Best display name for a lead — prefer Lead.name, fall back to per-channel
 * contact records, then to "Unknown".
 *
 * Older calls produced names with "{{template}}" leftovers from prompt
 * leakage; treat those as missing.
 */
function displayName(lead: Lead): string {
  const candidates = [
    lead.name,
    lead.socialContact?.contactName,
    lead.whatsappContact?.contactName,
  ];
  for (const c of candidates) {
    if (c && c.trim() && !c.includes("{{")) return c;
  }
  return "Unknown";
}

/**
 * Human-readable secondary identifier shown under the name in the Contact
 * cell. Picks the most useful piece of info per channel and falls back to
 * a friendly placeholder rather than exposing synthetic-phone strings.
 */
function displayIdentifier(lead: Lead): string {
  const channel = sourceToChannel(lead.source);

  if (channel === "instagram") {
    const handle = lead.socialContact?.handle;
    return handle ? `@${handle}` : "Instagram user";
  }

  if (channel === "facebook") {
    return "Messenger user";
  }

  if (channel === "website") {
    if (lead.email) return lead.email;
    // Synthetic phone for website leads is `website-{sessionId8}` — too
    // ugly to surface; show the trailing 8 chars only as a thin context.
    if (lead.phone.startsWith("website-")) {
      return `Session ${lead.phone.slice(-8)}`;
    }
    return lead.phone;
  }

  // Phone / WhatsApp / manual: phone is the real identifier IF it's a
  // genuine number rather than a synthetic prefix.
  if (
    lead.phone.startsWith("instagram-") ||
    lead.phone.startsWith("facebook-") ||
    lead.phone.startsWith("website-")
  ) {
    return "—";
  }
  return lead.phone;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLeads() {
      try {
        const res = await apiFetch("/api/leads");
        const data = await res.json();
        setLeads(data.leads || []);
      } catch (error) {
        console.error("Failed to fetch leads:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchLeads();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Customer contacts captured across all channels"
      />

      <Card className="py-0">
        <CardContent className="p-0">
          {/*
            The Email column is gone, and with it the horizontal scrollbar.

            For a website lead the Contact cell's second line already *is* the
            email — displayIdentifier() returns it — so every row printed the
            same address twice, and those duplicated ~180px were what pushed
            the table past the width of the page. Phone leads keep their email:
            it moved into the contact cell alongside the number.
          */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                  </TableCell>
                </TableRow>
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={Users}
                      title="No leads captured yet"
                      hint="A lead appears here as soon as someone leaves their details on a call or in a chat."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => {
                  const name = displayName(lead);
                  const identifier = displayIdentifier(lead);
                  // The dropped Email column's job. The identifier is already
                  // the email for website leads, so appending it again would
                  // just reinstate the duplication in a smaller font; a phone
                  // lead that also has an email gets both.
                  const secondary =
                    lead.email && lead.email !== identifier
                      ? `${identifier} · ${lead.email}`
                      : identifier;
                  const channel = sourceToChannel(lead.source);
                  const channelMeta = CHANNEL_META[channel];
                  const ChannelIcon = channelMeta.icon;
                  const avatarUrl = lead.socialContact?.profilePicUrl || null;
                  const initials = initialsFor(name === "Unknown" ? null : name, lead.phone);
                  const avatarColor = avatarColorFor(name + lead.phone);
                  return (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            {avatarUrl ? (
                              <Image
                                src={avatarUrl}
                                alt={name}
                                width={36}
                                height={36}
                                className="w-9 h-9 rounded-full object-cover"
                                unoptimized
                              />
                            ) : (
                              <div
                                className={cn(
                                  "w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold",
                                  avatarColor
                                )}
                              >
                                {initials}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div
                              className={cn(
                                "font-medium truncate",
                                name === "Unknown" && "text-muted-foreground italic"
                              )}
                            >
                              {name}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {secondary}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div
                            className={cn(
                              "w-5 h-5 rounded-full flex items-center justify-center",
                              channelMeta.bg
                            )}
                          >
                            <ChannelIcon className="w-3 h-3 text-white" />
                          </div>
                          <span className="text-xs text-foreground/80">
                            {channelMeta.label}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {lead.company || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/*
                        A real button, not a clickable cell.

                        Expanding used to be a td with cursor-pointer and a
                        title attribute — invisible to the keyboard, invisible
                        to a screen reader, and discoverable only by hovering
                        long enough for a tooltip. The text still truncates by
                        default; now something says so.
                      */}
                      <TableCell className="max-w-xs">
                        {lead.issue ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedIssue(
                                expandedIssue === lead.id ? null : lead.id
                              )
                            }
                            aria-expanded={expandedIssue === lead.id}
                            className={cn(
                              "text-sm text-left text-muted-foreground hover:text-foreground transition-colors w-full",
                              expandedIssue === lead.id
                                ? "whitespace-normal"
                                : "truncate"
                            )}
                          >
                            {lead.issue}
                          </button>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const s = leadStatus(lead.status);
                          return (
                            <span
                              className={cn(STATUS_BADGE, s.className)}
                            >
                              {s.label}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {lead._count.calls > 0 ? (
                          lead._count.calls
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(lead.createdAt), "d MMM yyyy")}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
