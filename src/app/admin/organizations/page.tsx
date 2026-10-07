"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DataTable,
  PersonCell,
  Pill,
  TableSearch,
  TableToolbar,
  type ColumnDef,
} from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Building2, Plus } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminUsageTable } from "@/components/usage/admin-usage-table";

interface Organization {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  enabled: boolean;
  createdAt: string;
  _count: {
    users: number;
    leads: number;
    calls: number;
    phoneNumbers: number;
    websites: number;
  };
}

export default function OrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", planTier: "starter" });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/organizations");
      const data = await res.json();
      setOrgs(data.organizations || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createOrg() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create");
        return;
      }
      setDialogOpen(false);
      setForm({ name: "", slug: "", planTier: "starter" });
      await load();
    } finally {
      setCreating(false);
    }
  }

  // Counts right-aligned and tabular, so they compare at a glance.
  const count = (id: string, header: string, get: (o: Organization) => number): ColumnDef<Organization> => ({
    id,
    header,
    accessorFn: get,
    meta: { align: "right" },
  });
  const columns: ColumnDef<Organization>[] = [
    {
      id: "name",
      header: "Organisation",
      accessorFn: (org) => `${org.name} ${org.slug}`,
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
      cell: ({ row: { original: org } }) => (
        <PersonCell name={org.name} detail={<code className="text-xs">{org.slug}</code>} />
      ),
    },
    {
      id: "plan",
      header: "Plan",
      accessorKey: "planTier",
      meta: { className: "capitalize" },
    },
    count("users", "Users", (o) => o._count.users),
    count("leads", "Leads", (o) => o._count.leads),
    count("calls", "Calls", (o) => o._count.calls),
    count("sites", "Sites", (o) => o._count.websites),
    {
      // Disabled is the state a super-admin is scanning for: it stands out.
      id: "status",
      header: "Status",
      accessorFn: (org) => (org.enabled ? "Enabled" : "Disabled"),
      cell: ({ row: { original: org } }) =>
        org.enabled ? (
          <Pill className="bg-tea-green-800 text-tea-green-100">Enabled</Pill>
        ) : (
          <Pill className="bg-red-50 text-red-800">Disabled</Pill>
        ),
    },
    {
      id: "created",
      header: "Created",
      accessorFn: (org) => org.createdAt,
      meta: { className: "whitespace-nowrap text-muted-foreground" },
      cell: ({ row: { original: org } }) => format(new Date(org.createdAt), "d MMM yyyy"),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            New organisation
          </Button>
        }
      />

      <TableToolbar>
        <TableSearch label="Search organisations" placeholder="Search organisations" value={query} onChange={setQuery} />
      </TableToolbar>

      <DataTable
        columns={columns}
        data={orgs}
        getRowId={(org) => org.id}
        onRowClick={(org) => router.push(`/admin/organizations/${org.id}`)}
        rowLabel={(org) => org.name}
        search={query}
        loading={loading}
        empty={
          <EmptyState
            icon={Building2}
            title={query ? "No organisations match that" : "No organisations yet"}
            hint={query ? undefined : "Each client gets one. Everything else in the CRM is scoped to it."}
            action={
              query ? undefined : (
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New organisation
                </Button>
              )
            }
          />
        }
      />

      <AdminUsageTable names={Object.fromEntries(orgs.map((o) => [o.id, o.name]))} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organisation</DialogTitle>
            <DialogDescription>
              Set up a new client organisation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Corp"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Slug</label>
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                placeholder="acme-corp"
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Lowercase alphanumeric with dashes
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={createOrg}
              disabled={creating || !form.name || !form.slug}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
