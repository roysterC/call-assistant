"use client";

import { useEffect, useState } from "react";
import {
  DataTable,
  PersonCell,
  SubText,
  TableSearch,
  TableToolbar,
  type ColumnDef,
} from "@/components/ui/data-table";
import { Users } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { plural } from "@/lib/plural";
import { CHANNEL_META, type Channel } from "@/lib/channels";
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
  phone: string | null;
  company: string | null;
  issue: string | null;
  status: string;
  source: string;
  createdAt: string;
  _count: { calls: number; callbacks: number };
  socialContact: SocialContact | null;
  whatsappContact: WhatsAppContact | null;
  contactLead: { name: string | null; phone: string | null } | null;
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
    // Email is this channel's identity now, so it is almost always present.
    return lead.email || lead.phone || "—";
  }

  // Phone / WhatsApp / manual: the number is the real identifier, unless it is
  // one of the synthetic values the other channels used to invent. Website no
  // longer creates `website-{session}` at all, but rows written before that
  // change still carry one.
  const phone = lead.phone;
  // Reached through someone else's number (a child on a parent's phone).
  if (!phone && lead.contactLead) {
    return [`via ${lead.contactLead.name ?? "another client"}`, lead.contactLead.phone].filter(Boolean).join(" · ");
  }
  if (
    !phone ||
    phone.startsWith("instagram-") ||
    phone.startsWith("facebook-") ||
    phone.startsWith("website-")
  ) {
    return "—";
  }
  return phone;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const columns: ColumnDef<Lead>[] = [
    {
      // For a website lead the identifier already is the email, so it is
      // not printed twice; a phone lead that also has an email gets both.
      id: "contact",
      header: "Contact",
      accessorFn: (lead) =>
        [displayName(lead), displayIdentifier(lead), lead.email, lead.company].filter(Boolean).join(" "),
      sortingFn: (a, b) => displayName(a.original).localeCompare(displayName(b.original)),
      cell: ({ row: { original: lead } }) => {
        const name = displayName(lead);
        const identifier = displayIdentifier(lead);
        return (
          <PersonCell
            name={name === "Unknown" ? null : name}
            photoUrl={lead.socialContact?.profilePicUrl}
            detail={[identifier, lead.email !== identifier && lead.email, lead.company].filter(Boolean).join(" · ")}
          />
        );
      },
    },
    {
      id: "channel",
      header: "Channel",
      accessorFn: (lead) => CHANNEL_META[sourceToChannel(lead.source)].label,
      cell: ({ row: { original: lead } }) => {
        const meta = CHANNEL_META[sourceToChannel(lead.source)];
        const ChannelIcon = meta.icon;
        return (
          <span className="flex items-center gap-1.5">
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", meta.bg)}>
              <ChannelIcon className="h-3 w-3 text-white" />
            </span>
            <span className="text-xs text-foreground/80">{meta.label}</span>
          </span>
        );
      },
    },
    {
      // A real button, so it can be reached by keyboard and says it expands.
      id: "issue",
      header: "Issue",
      enableSorting: false,
      accessorFn: (lead) => lead.issue ?? "",
      cell: ({ row: { original: lead } }) =>
        lead.issue ? (
          <button
            type="button"
            onClick={() => setExpandedIssue(expandedIssue === lead.id ? null : lead.id)}
            aria-expanded={expandedIssue === lead.id}
            className={cn(
              "block w-full max-w-48 text-left text-muted-foreground transition-colors hover:text-foreground",
              expandedIssue === lead.id ? "whitespace-normal" : "truncate"
            )}
          >
            {lead.issue}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (lead) => leadStatus(lead.status).label,
      meta: { className: "whitespace-nowrap" },
      cell: ({ row: { original: lead } }) => {
        const st = leadStatus(lead.status);
        return <span className={cn(STATUS_BADGE, st.className)}>{st.label}</span>;
      },
    },
    {
      id: "created",
      header: "Created",
      accessorFn: (lead) => lead.createdAt,
      meta: { className: "whitespace-nowrap text-muted-foreground" },
      cell: ({ row: { original: lead } }) => (
        <>
          {format(new Date(lead.createdAt), "d MMM yyyy")}
          {lead._count.calls > 0 && <SubText>{plural(lead._count.calls, "call")}</SubText>}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
      />

      <TableToolbar>
        <TableSearch label="Search leads" placeholder="Search leads" value={query} onChange={setQuery} />
      </TableToolbar>

      <DataTable
        columns={columns}
        data={leads}
        getRowId={(lead) => lead.id}
        search={query}
        loading={loading}
        pageSize={25}
        noun="leads"
        empty={
          <EmptyState
            icon={Users}
            title={query ? "No leads match that" : "No leads captured yet"}
            hint={
              query
                ? "Try part of their name, number, email or company."
                : "A lead appears here as soon as someone leaves their details on a call or in a chat."
            }
          />
        }
      />
    </div>
  );
}
