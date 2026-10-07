"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, PersonCell, Pill, type ColumnDef } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Globe, Copy, Check, Plus } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

interface Site {
  id: string;
  siteId: string;
  name: string;
  botName: string;
  enabled: boolean;
  brandColor: string;
  createdAt: string;
  _count: { conversations: number };
}

// Next 16 requires useSearchParams() to be wrapped in Suspense for any
// prerenderable page — otherwise the build fails with a CSR-bailout error.
export default function WebsitesPage() {
  return (
    <Suspense fallback={null}>
      <WebsitesPageInner />
    </Suspense>
  );
}

function WebsitesPageInner() {
  const router = useRouter();
  // Preserve ?asOrg when navigating into a site detail. Without this,
  // super-admins viewing another org would jump back to their home org
  // on click. Mirrors the navSuffix pattern used in the sidebar.
  const searchParams = useSearchParams();
  const asOrg = searchParams.get("asOrg");
  const navSuffix = asOrg ? `?asOrg=${asOrg}` : "";
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/websites");
      const data = await res.json();
      setSites(data.sites || []);
    } catch (err) {
      console.error("Failed to load sites:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function copyEmbed(siteId: string) {
    const origin = window.location.origin;
    const snippet = `<script src="${origin}/widget.js" data-site-id="${siteId}" async></script>`;
    navigator.clipboard.writeText(snippet);
    setCopiedId(siteId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const columns: ColumnDef<Site>[] = [
    {
      id: "name",
      header: "Website",
      accessorKey: "name",
      cell: ({ row: { original: site } }) => (
        <PersonCell name={site.name} detail={<code className="text-xs">{site.siteId}</code>} />
      ),
    },
    { id: "bot", header: "Bot", accessorKey: "botName" },
    {
      id: "conversations",
      header: "Conversations",
      accessorFn: (site) => site._count.conversations,
      meta: { align: "right" },
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (site) => (site.enabled ? "Live" : "Off"),
      cell: ({ row: { original: site } }) =>
        site.enabled ? (
          <Pill className="bg-tea-green-800 text-tea-green-100">Live</Pill>
        ) : (
          <Pill className="bg-muted text-muted-foreground">Off</Pill>
        ),
    },
    {
      id: "created",
      header: "Created",
      accessorFn: (site) => site.createdAt,
      meta: { className: "whitespace-nowrap text-muted-foreground" },
      cell: ({ row: { original: site } }) => format(new Date(site.createdAt), "d MMM yyyy"),
    },
    {
      id: "embed",
      header: () => <span className="sr-only">Embed code</span>,
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row: { original: site } }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            copyEmbed(site.siteId);
          }}
          aria-label={`Copy embed code for ${site.name}`}
          title="Copy embed code"
        >
          {copiedId === site.siteId ? <Check className="h-4 w-4 text-tea-green-200" /> : <Copy className="h-4 w-4" />}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Websites"
        actions={
          <Button onClick={() => router.push(`/websites/new${navSuffix}`)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add website
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={sites}
        getRowId={(site) => site.id}
        onRowClick={(site) => router.push(`/websites/${site.id}${navSuffix}`)}
        rowLabel={(site) => site.name}
        loading={loading}
        empty={
          <EmptyState
            icon={Globe}
            title="No chatbot set up yet"
            hint="Add a website to generate a chatbot and the one-line snippet that puts it on your page."
            action={
              <Button size="sm" onClick={() => router.push(`/websites/new${navSuffix}`)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add website
              </Button>
            }
          />
        }
      />
    </div>
  );
}
