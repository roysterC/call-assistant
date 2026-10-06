"use client";

/**
 * The salon's clients: who they are, when they were last in and what they
 * have coming, searchable. Opening one shows their bookings, notes and patch
 * test (ClientSheet).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contact } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DataTable,
  PersonCell,
  Pill,
  SubText,
  TableSearch,
  TableToolbar,
  type ColumnDef,
  type SortingState,
} from "@/components/ui/data-table";
import { ClientSheet } from "@/components/clients/client-sheet";
import { apiFetch } from "@/lib/api-fetch";
import { plural } from "@/lib/plural";

interface ClientRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  contactLead: { name: string | null; phone: string | null } | null;
  lastVisit: string | null;
  visits: number;
  nextBooking: string | null;
}

const PAGE = 50;

/** The columns the server can sort by, by column id. */
const SERVER_SORT: Record<string, string> = { name: "firstName", email: "email" };

const nextLabel = (iso: string) => format(new Date(iso), "EEE d MMM, h:mmaaa").replace(":00", "");

export default function ClientsPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Search as they type, once they pause.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    async (offset: number) => {
      const sort = sorting[0];
      const qs = new URLSearchParams({
        limit: String(PAGE),
        offset: String(offset),
        sort: SERVER_SORT[sort?.id ?? "name"] ?? "firstName",
        dir: sort?.desc ? "desc" : "asc",
      });
      if (search) qs.set("q", search);
      const res = await apiFetch(`/api/clients?${qs}`);
      if (!res.ok) throw new Error();
      return (await res.json()) as { clients: ClientRow[]; total: number };
    },
    [search, sorting]
  );

  /** From the top: on a new search or sort, and after a change in the sheet. */
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const d = await fetchPage(0);
      setClients(d.clients ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  async function showMore() {
    setLoadingMore(true);
    try {
      const d = await fetchPage(clients.length);
      setClients((prev) => [...prev, ...(d.clients ?? [])]);
      setTotal(d.total ?? 0);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const columns = useMemo<ColumnDef<ClientRow>[]>(
    () => [
      {
        id: "name",
        header: "Client",
        accessorFn: (c) => c.name ?? "",
        cell: ({ row: { original: c } }) => (
          <PersonCell
            name={c.name}
            detail={c.phone ?? (c.contactLead ? `via ${c.contactLead.name ?? "another client"}` : null)}
          />
        ),
      },
      {
        id: "email",
        header: "Email",
        accessorFn: (c) => c.email ?? "",
        cell: ({ row: { original: c } }) => <span className="text-muted-foreground">{c.email ?? "—"}</span>,
      },
      {
        id: "lastVisit",
        header: "Last visit",
        enableSorting: false,
        cell: ({ row: { original: c } }) => (
          <span className="text-muted-foreground">
            {c.lastVisit ? format(new Date(c.lastVisit), "d MMM yyyy") : "—"}
            <SubText>{plural(c.visits, "visit")}</SubText>
          </span>
        ),
      },
      {
        id: "nextBooking",
        header: "Next booking",
        enableSorting: false,
        cell: ({ row: { original: c } }) =>
          c.nextBooking ? (
            <Pill>{nextLabel(c.nextBooking)}</Pill>
          ) : (
            <span className="text-[13px] text-muted-foreground/80">Nothing booked</span>
          ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" />

      <TableToolbar>
        <TableSearch
          label="Search clients"
          placeholder="Search by name, number or email"
          value={query}
          onChange={setQuery}
        />
      </TableToolbar>

      {failed && (
        <p role="alert" className="text-sm text-red-600">
          Clients couldn&apos;t be loaded. Refresh to try again.
        </p>
      )}

      <DataTable
        columns={columns}
        data={clients}
        getRowId={(c) => c.id}
        onRowClick={(c) => setOpenId(c.id)}
        rowLabel={(c) => c.name ?? "client"}
        loading={loading}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        total={total}
        onShowMore={showMore}
        loadingMore={loadingMore}
        noun="clients"
        empty={
          <EmptyState
            icon={Contact}
            title={search ? "No clients match that" : "No clients yet"}
            hint={search ? "Try part of their name, number or email." : "Clients appear here as they are booked."}
          />
        }
      />

      <ClientSheet clientId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
