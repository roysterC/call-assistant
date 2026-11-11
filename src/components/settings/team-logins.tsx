"use client";

/**
 * Team logins, in Settings, for the salon's owner: who can sign in, staff
 * invited and not joined yet, and a way to invite or remove staff. Before
 * this every login went through Kikai. Making someone else an owner still
 * does (Admin), so an owner cannot lose the salon by a slip.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, Send, Trash2, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LanguageFlags } from "@/components/i18n/language-flags";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { useLanguage, useT } from "@/components/providers/language-provider";
import type { Lang } from "@/lib/i18n";

interface Login {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isYou: boolean;
}

interface Pending {
  id: string;
  email: string;
  language: string;
}

export function TeamLogins({ salon }: { salon: string }) {
  const { t } = useT();
  const { lang } = useLanguage();
  const { confirm, notify } = useDialogs();
  const [data, setData] = useState<{ users: Login[]; invitations: Pending[]; canEmail: boolean } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<Lang>(lang);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/team-logins");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Arriving from "Invite your team" (onboarding's last screen): the section
  // only exists once Settings has loaded, so the browser cannot scroll to it.
  const loaded = data !== null;
  useEffect(() => {
    if (loaded && window.location.hash === "#team-logins") {
      document.getElementById("team-logins")?.scrollIntoView({ block: "start" });
    }
  }, [loaded]);

  async function call(url: string, init: RequestInit, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await apiFetch(url, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(
          d.code === "noEmail"
            ? t("logins.noEmail")
            : d.code === "taken"
              ? t("inv.err.taken")
              : d.code === "email"
                ? t("auth.enterEmail")
                : res.status === 429
                  ? t("common.tooMany")
                  : t("logins.failed")
        );
        return false;
      }
      if (success) notify(success, "success");
      await load();
      return true;
    } catch {
      notify(t("common.offline"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    const to = email.trim();
    const ok = await call(
      "/api/team-logins",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: to, language }) },
      t("logins.sent", { email: to })
    );
    if (ok) {
      setInviting(false);
      setEmail("");
    }
  }

  async function remove(u: Login) {
    const name = u.name || u.email;
    const yes = await confirm({
      title: t("logins.removeQ", { name }),
      body: t("logins.removeBody"),
      confirmLabel: t("logins.remove"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (yes) await call(`/api/team-logins/${u.id}`, { method: "DELETE" });
  }

  return (
    <Card id="team-logins" className="scroll-mt-6 gap-0" data-testid="team-logins">
      <CardHeader className="border-b pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("logins.title")}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setInviting(true)} disabled={!data?.canEmail}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            {t("logins.invite")}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("logins.intro", { salon })}</p>
        {data && !data.canEmail && <p className="mt-1 text-xs text-muted-foreground">{t("logins.noEmail")}</p>}
      </CardHeader>
      <CardContent className="p-0">
        {!data ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="team-login">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tea-green-900 text-xs font-semibold text-tea-green-200">
                  {(u.name || u.email)[0].toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {u.name || u.email}
                    {u.isYou && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({t("logins.you")})</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                  {u.role === "admin" ? t("logins.owner") : t("logins.staff")}
                </Badge>
                {u.role === "member" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(u)}
                    disabled={busy}
                    aria-label={`${t("logins.remove")}: ${u.name || u.email}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
            {data.invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="team-invitation">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                  <Mail className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">{t("logins.pending")}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !data.canEmail}
                  onClick={() =>
                    call(`/api/team-logins/invitations/${inv.id}`, { method: "POST" }, t("logins.sent", { email: inv.email }))
                  }
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  {t("logins.resend")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => call(`/api/team-logins/invitations/${inv.id}`, { method: "DELETE" })}
                >
                  {t("logins.withdraw")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("logins.inviteTitle")}</DialogTitle>
            <DialogDescription>{t("logins.inviteIntro")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor="staff-email" className="text-sm font-medium">{t("logins.email")}</label>
              <Input
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("language.label")}</span>
              <LanguageFlags value={language} onChange={setLanguage} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={invite} disabled={busy || !email.trim()}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("logins.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
