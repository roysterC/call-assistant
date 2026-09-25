"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { STATUS_BADGE } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        description="Super-admin view of all client organisations"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            New organisation
          </Button>
        }
      />

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Sites</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                  </TableCell>
                </TableRow>
              ) : orgs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Building2}
                      title="No organisations yet"
                      hint="Each client gets one. Everything else in the CRM is scoped to it."
                      action={
                        <Button size="sm" onClick={() => setDialogOpen(true)}>
                          <Plus className="w-4 h-4 mr-1.5" />
                          New organisation
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                orgs.map((org) => (
                  <TableRow
                    key={org.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => router.push(`/admin/organizations/${org.id}`)}
                  >
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {org.slug}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {org.planTier}
                    </TableCell>
                    {/*
                      Counts right-aligned and tabular. Four numeric columns
                      left-aligned in proportional figures is four ragged edges
                      you have to read digit by digit to compare.
                    */}
                    <TableCell className="text-sm text-right tabular-nums">
                      {org._count.users}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">
                      {org._count.leads}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">
                      {org._count.calls}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">
                      {org._count.websites}
                    </TableCell>
                    <TableCell>
                      {/*
                        Disabled is the state a super-admin is scanning for, and
                        the secondary Badge made it the quieter of the two.
                      */}
                      <span
                        className={cn(
                          STATUS_BADGE,
                          org.enabled
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        )}
                      >
                        {org.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(org.createdAt), "d MMM yyyy")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
