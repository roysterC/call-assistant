"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Websites"
        description="Embeddable chatbots for your websites"
        actions={
          <Button onClick={() => router.push(`/websites/new${navSuffix}`)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add website
          </Button>
        }
      />

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Site ID</TableHead>
                <TableHead>Bot</TableHead>
                <TableHead>Conversations</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                  </TableCell>
                </TableRow>
              ) : sites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={Globe}
                      title="No chatbot set up yet"
                      hint="Add a website to generate a chatbot and the one-line snippet that puts it on your page."
                      action={
                        <Button
                          size="sm"
                          onClick={() =>
                            router.push(`/websites/new${navSuffix}`)
                          }
                        >
                          <Plus className="w-4 h-4 mr-1.5" />
                          Add website
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                sites.map((site) => (
                  <TableRow
                    key={site.id}
                    className="cursor-pointer hover:bg-white/5"
                    onClick={() => router.push(`/websites/${site.id}${navSuffix}`)}
                  >
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">
                        {site.siteId}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm">{site.botName}</TableCell>
                    <TableCell className="text-sm">
                      {site._count.conversations}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={site.enabled ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {site.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(site.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyEmbed(site.siteId);
                        }}
                        title="Copy embed code"
                      >
                        {copiedId === site.siteId ? (
                          <Check className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
