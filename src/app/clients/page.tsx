"use client";

/**
 * The salon's clients: name, number and email, searchable. Opening one shows
 * their bookings, notes and patch test (ClientSheet).
 */

import { useCallback, useEffect, useState } from "react";
import { Contact, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientSheet } from "@/components/clients/client-sheet";
import { apiFetch } from "@/lib/api-fetch";

interface ClientRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  contactLead: { name: string | null; phone: string | null } | null;
}

const PAGE = 50;

export default function ClientsPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Search as they type, once they pause.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort: "firstName" });
      if (search) qs.set("q", search);
      const res = await apiFetch(`/api/clients?${qs}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setClients(d.clients ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [search, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search clients"
          placeholder="Search by name, number or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-red-600">
                    Clients couldn&apos;t be loaded. Refresh to try again.
                  </TableCell>
                </TableRow>
              ) : !loading && clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="p-0">
                    <EmptyState
                      icon={Contact}
                      title={search ? "No clients match that" : "No clients yet"}
                      hint={search ? "Try part of their name, number or email." : "Clients appear here as they are booked."}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((c) => (
                  <TableRow
                    key={c.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${c.name ?? "client"}`}
                    onClick={() => setOpenId(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenId(c.id);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {c.phone ?? (c.contactLead ? (
                        <span className="text-muted-foreground">via {c.contactLead.name ?? "another client"}</span>
                      ) : (
                        "—"
                      ))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {from}–{to} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={to >= total || loading} onClick={() => setOffset(offset + PAGE)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <ClientSheet clientId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
