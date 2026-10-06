"use client";

/**
 * Which services one stylist does, chosen in a pop-up of checkboxes.
 *
 * The services list can run to dozens, and as a row of toggles under every
 * stylist it buried the rest of the team. The editor shows a one-line summary;
 * the pop-up has a search box and the full list. Nothing changes until Done,
 * so Cancel leaves the stylist as they were.
 *
 * None ticked means they do everything, the same rule the booking engine
 * applies, so a service added later is theirs without coming back here.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SalonService } from "@/lib/salon-config";

/** "Everything", "Root Tint", "Root Tint and Balayage", "Root Tint and 4 more". */
export function servicesSummary(selected: string[]): string {
  if (selected.length === 0) return "Everything";
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} and ${selected[1]}`;
  return `${selected[0]} and ${selected.length - 1} more`;
}

export function ServicePicker({
  stylistName,
  services,
  value,
  onChange,
}: {
  stylistName: string;
  services: SalonService[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  // A ticked name no longer on the list (renamed or removed) is not shown,
  // and is dropped on Done rather than kept invisibly.
  const known = useMemo(() => new Set(services.map((s) => s.name)), [services]);
  const current = value.filter((name) => known.has(name));

  const q = query.trim().toLowerCase();
  const shown = q ? services.filter((s) => s.name.toLowerCase().includes(q)) : services;

  function start() {
    setDraft(current);
    setQuery("");
    setOpen(true);
  }

  function toggle(name: string) {
    setDraft((d) => (d.includes(name) ? d.filter((n) => n !== name) : [...d, name]));
  }

  function done() {
    // In the list's own order, so the summary and the stored value are stable.
    onChange(services.map((s) => s.name).filter((name) => draft.includes(name)));
    setOpen(false);
  }

  const who = stylistName.trim() || "this stylist";

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={start} aria-label={`Choose services for ${who}`}>
          {current.length === 0 ? "All services" : `${current.length} of ${services.length}`}
          <span className="ml-1 text-muted-foreground">· Edit</span>
        </Button>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {current.length === 0 ? "None ticked, so they do everything." : servicesSummary(current)}
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Services {who} does</DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search services"
              placeholder="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{draft.length === 0 ? "None ticked: they do everything." : `${draft.length} ticked`}</span>
            <span className="flex gap-3">
              <button type="button" className="hover:text-foreground hover:underline" onClick={() => setDraft(services.map((s) => s.name))}>
                Tick all
              </button>
              <button type="button" className="hover:text-foreground hover:underline" onClick={() => setDraft([])}>
                Clear
              </button>
            </span>
          </div>

          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border" aria-label="Services">
            {shown.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">No services match that.</li>
            ) : (
              shown.map((s) => {
                const id = `svc-${s.name.replace(/\W+/g, "-")}`;
                return (
                  <li key={s.name}>
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50">
                      <input
                        id={id}
                        type="checkbox"
                        checked={draft.includes(s.name)}
                        onChange={() => toggle(s.name)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="flex-1">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.durationMinutes} min</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={done}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
