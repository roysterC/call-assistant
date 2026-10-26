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
import { useT } from "@/components/providers/language-provider";
import { DATE_FNS_LOCALE, type Lang } from "@/lib/i18n";

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
const SERVER_SORT: Record<string, string> = {
  name: "firstName",
  email: "email",
  lastVisit: "lastVisit",
  nextBooking: "nextBooking",
};

// "Thu 3 Oct, 2pm"; in Vietnamese "Th 5 3 thg 10, 14:00".
const nextLabel = (iso: string, lang: Lang) =>
  lang === "vi"
    ? format(new Date(iso), "EEE d MMM, HH:mm", { locale: DATE_FNS_LOCALE.vi })
    : format(new Date(iso), "EEE d MMM, h:mmaaa").replace(":00", "");

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
  const { t, lang } = useT();

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
        header: t("clients.client"),
        accessorFn: (c) => c.name ?? "",
        cell: ({ row: { original: c } }) => (
          <PersonCell
            name={c.name}
            detail={
              c.phone ?? (c.contactLead ? t("clients.via", { name: c.contactLead.name ?? t("clients.anotherClient") }) : null)
            }
          />
        ),
      },
      {
        id: "email",
        header: t("clients.email"),
        accessorFn: (c) => c.email ?? "",
        cell: ({ row: { original: c } }) => <span className="text-muted-foreground">{c.email ?? "—"}</span>,
      },
      {
        id: "lastVisit",
        header: t("clients.lastVisit"),
        // Oldest first on the first click: who hasn't been in for a while.
        sortDescFirst: false,
        accessorFn: (c) => c.lastVisit ?? "",
        cell: ({ row: { original: c } }) => (
          <span className="text-muted-foreground">
            {c.lastVisit ? format(new Date(c.lastVisit), "d MMM yyyy", { locale: DATE_FNS_LOCALE[lang] }) : "—"}
            <SubText>{t(c.visits === 1 ? "clients.visitOne" : "clients.visitMany", { n: c.visits })}</SubText>
          </span>
        ),
      },
      {
        id: "nextBooking",
        header: t("clients.nextBooking"),
        // Soonest first. Clients with nothing booked come last either way.
        sortDescFirst: false,
        accessorFn: (c) => c.nextBooking ?? "",
        cell: ({ row: { original: c } }) =>
          c.nextBooking ? (
            <Pill>{nextLabel(c.nextBooking, lang)}</Pill>
          ) : (
            <span className="text-[13px] text-muted-foreground/80">{t("clients.nothingBooked")}</span>
          ),
      },
    ],
    [t, lang]
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("clients.title")} />

      <TableToolbar>
        <TableSearch
          label={t("clients.searchLabel")}
          placeholder={t("clients.searchPlaceholder")}
          value={query}
          onChange={setQuery}
        />
      </TableToolbar>

      {failed && (
        <p role="alert" className="text-sm text-red-600">
          {t("clients.loadFailed")}
        </p>
      )}

      <DataTable
        columns={columns}
        data={clients}
        getRowId={(c) => c.id}
        onRowClick={(c) => setOpenId(c.id)}
        rowLabel={(c) => c.name ?? t("clients.rowLabel")}
        loading={loading}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        total={total}
        onShowMore={showMore}
        loadingMore={loadingMore}
        noun={t("clients.noun")}
        empty={
          <EmptyState
            icon={Contact}
            title={search ? t("clients.noMatch") : t("clients.none")}
            hint={search ? t("clients.noMatchHint") : t("clients.noneHint")}
          />
        }
      />

      <ClientSheet clientId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
