"use client";

/**
 * Logins for the stylists: who has one, what each can see, and adding one.
 *
 * Saved as it is changed, not with the rest of the settings page: a login is a
 * person's access, and "I ticked it but did not press save" is not a state a
 * permission should be left in.
 */

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, KeyRound, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-fetch";

interface Login {
  id: string;
  email: string;
  name: string | null;
  stylistName: string | null;
  diaryScope: string;
  canSeeTakings: boolean;
  mustChangePassword: boolean;
}

const SCOPE_LABEL: Record<string, string> = {
  salon: "Whole salon (others read-only)",
  own: "Own column only",
};

export function TeamLogins({ stylists }: { stylists: string[] }) {
  const [logins, setLogins] = useState<Login[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The one time a password is shown: after creating a login or resetting it.
  const [revealed, setRevealed] = useState<{ who: string; email: string; password: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ stylistName: "", email: "", diaryScope: "salon", canSeeTakings: true });
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/team-logins");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLogins(data.logins ?? []);
    } catch {
      setError("Could not load the logins.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That did not save.");
        return null;
      }
      return data;
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const update = async (login: Login, patch: Record<string, unknown>) => {
    const data = await call(`/api/team-logins/${login.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!data) return;
    setLogins((ls) => ls.map((l) => (l.id === login.id ? data.login : l)));
    if (data.temporaryPassword) {
      setRevealed({
        who: login.stylistName ?? login.email,
        email: login.email,
        password: data.temporaryPassword,
      });
    }
  };

  const create = async () => {
    const data = await call("/api/team-logins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!data) return;
    setLogins((ls) => [...ls, data.login]);
    setRevealed({ who: data.login.stylistName, email: data.login.email, password: data.temporaryPassword });
    setAdding(false);
    setForm({ stylistName: "", email: "", diaryScope: "salon", canSeeTakings: true });
  };

  const remove = async (login: Login) => {
    const data = await call(`/api/team-logins/${login.id}`, { method: "DELETE" });
    if (!data) return;
    setLogins((ls) => ls.filter((l) => l.id !== login.id));
    setConfirmRemove(null);
  };

  const withLogin = new Set(logins.map((l) => (l.stylistName ?? "").toLowerCase()));
  const available = stylists.filter((s) => !withLogin.has(s.toLowerCase()));
  const known = new Set(stylists.map((s) => s.toLowerCase()));

  return (
    <div className="space-y-4">
      {revealed && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm space-y-1.5">
          <p className="font-medium">Temporary password for {revealed.who}</p>
          <p className="text-muted-foreground text-xs">
            Pass this on to them. They sign in with <span className="text-foreground">{revealed.email}</span> and
            will be asked to choose their own password. It won&apos;t be shown again.
          </p>
          <p className="font-mono text-lg tracking-wider select-all">{revealed.password}</p>
          <Button variant="outline" size="sm" onClick={() => setRevealed(null)}>
            Done
          </Button>
        </div>
      )}

      {loaded && logins.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No stylist has a login yet.</p>
      )}

      {logins.map((l) => {
        const linked = l.stylistName !== null && known.has(l.stylistName.toLowerCase());
        return (
          <div key={l.id} className="rounded-md border p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{l.stylistName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {l.email}
                  {l.mustChangePassword && " · hasn't chosen a password yet"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => update(l, { resetPassword: true })}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Reset password
                </Button>
                {confirmRemove === l.id ? (
                  <Button variant="destructive" size="sm" disabled={busy} onClick={() => remove(l)}>
                    Remove {l.stylistName}&apos;s login
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${l.stylistName}'s login`}
                    disabled={busy}
                    onClick={() => setConfirmRemove(l.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            {!linked && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                No stylist called {l.stylistName} any more, so this login can&apos;t
                use the diary. Rename the stylist back, or remove the login and add it again.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Diary</span>
                <Select
                  value={l.diaryScope}
                  onValueChange={(v) => v && v !== l.diaryScope && update(l, { diaryScope: v })}
                  disabled={busy}
                >
                  <SelectTrigger className="h-8 w-60">
                    <SelectValue>{SCOPE_LABEL[l.diaryScope]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="salon">{SCOPE_LABEL.salon}</SelectItem>
                    <SelectItem value="own">{SCOPE_LABEL.own}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={l.canSeeTakings}
                  disabled={busy}
                  onChange={(e) => update(l, { canSeeTakings: e.target.checked })}
                  className="h-4 w-4 accent-foreground"
                />
                Sees their own takings
              </label>
            </div>
          </div>
        );
      })}

      {adding ? (
        <form
          className="rounded-md border p-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) create();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Stylist</span>
              <Select
                value={form.stylistName}
                onValueChange={(v) => setForm({ ...form, stylistName: v ?? "" })}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Their email (what they sign in with)</span>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="h-8"
                required
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Diary</span>
              <Select
                value={form.diaryScope}
                onValueChange={(v) => setForm({ ...form, diaryScope: v ?? "salon" })}
              >
                <SelectTrigger className="h-8 w-60">
                  <SelectValue>{SCOPE_LABEL[form.diaryScope]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salon">{SCOPE_LABEL.salon}</SelectItem>
                  <SelectItem value="own">{SCOPE_LABEL.own}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.canSeeTakings}
                onChange={(e) => setForm({ ...form, canSeeTakings: e.target.checked })}
                className="h-4 w-4 accent-foreground"
              />
              Sees their own takings
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.stylistName || !form.email}>
              {busy ? "Creating…" : "Create login"}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setAdding(true);
            setRevealed(null);
          }}
          disabled={available.length === 0}
        >
          <UserPlus className="h-3.5 w-3.5" />
          {available.length === 0 && stylists.length > 0 ? "Every stylist has a login" : "Give a stylist a login"}
        </Button>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
