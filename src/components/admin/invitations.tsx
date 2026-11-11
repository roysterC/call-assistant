"use client";

/**
 * Invitations on Admin → Organisations: the link to send a salon's owner,
 * and the salon's invitations with what became of each.
 *
 * The link is shown once, when it is made: only a hash of it is kept
 * (src/lib/invitations.ts). Lost it? "New link" makes another and the old
 * one stops working.
 */

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Copy, Link2, Loader2, Mail, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { INVITE_DAYS, inviteStatus, type InviteStatus } from "@/lib/invite-status";
import { LanguageFlags } from "@/components/i18n/language-flags";
import { Textarea } from "@/components/ui/textarea";
import type { Lang } from "@/lib/i18n";

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

/** The link to send, with a button to copy it. */
export function InviteLinkDialog({
  link,
  email,
  onClose,
}: {
  link: string | null;
  email: string;
  onClose: () => void;
}) {
  // Which link was copied, so a new link starts un-copied.
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const copied = link !== null && copiedLink === link;
  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send this link to {email}</DialogTitle>
          <DialogDescription>
            They open it to make their login, then set up their salon. It works once, for {INVITE_DAYS} days. Copy it now:
            it can&apos;t be shown again, though you can make a new one. A login made from a copied link isn&apos;t
            counted as a confirmed email until they confirm it from their Account page.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={link ?? ""} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="font-mono text-xs" />
          <Button
            type="button"
            onClick={async () => {
              if (!link) return;
              await navigator.clipboard.writeText(link).catch(() => {});
              setCopiedLink(link);
            }}
          >
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Delivery = "email" | "link";

interface Invitation {
  id: string;
  email: string;
  role: string;
  /** "email": sent by the app. "link": copied by Kikai to pass on. */
  delivery: Delivery;
  language: string;
  remindedAt: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const STATUS: Record<InviteStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Waiting", variant: "default" },
  accepted: { label: "Joined", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
  revoked: { label: "Withdrawn", variant: "outline" },
};

/** The salon's invitations, and a way to invite someone. */
export function InvitationsSection({ orgId, onChange }: { orgId: string; onChange?: () => void }) {
  const { confirm, notify } = useDialogs();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ email: "", role: "admin", language: "en" as Lang, note: "" });
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ link: string; email: string } | null>(null);
  // Whether the server can send email; until it can, links are copied.
  const [canEmail, setCanEmail] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/organizations/${orgId}/invitations`);
    if (!res.ok) return;
    const d = await res.json();
    setInvitations(d.invitations);
    setCanEmail(Boolean(d.canEmail));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Make an invitation, emailed or as a link to copy; whether it worked. */
  async function send(url: string, body: Record<string, unknown>, email: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(d.error || "Couldn't make the invitation. Try again.");
        return false;
      }
      if (d.emailed) notify(`Invitation emailed to ${email}`, "success");
      else setShown({ link: inviteLink(d.token), email });
      await load();
      onChange?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function invite(delivery: Delivery) {
    const ok = await send(`/api/admin/organizations/${orgId}/invitations`, { ...form, delivery }, form.email.trim());
    if (ok) {
      setInviting(false);
      setForm({ email: "", role: "admin", language: "en", note: "" });
    }
  }

  async function revoke(inv: Invitation) {
    const yes = await confirm({
      title: `Withdraw the invitation to ${inv.email}?`,
      body: "Their link will stop working.",
      confirmLabel: "Withdraw",
      destructive: true,
    });
    if (!yes) return;
    const res = await fetch(`/api/admin/organizations/${orgId}/invitations/${inv.id}`, { method: "DELETE" });
    if (!res.ok) notify((await res.json().catch(() => ({}))).error || "Couldn't withdraw it. Try again.");
    await load();
  }

  return (
    <section className="space-y-3" aria-labelledby="org-invitations">
      <div className="flex items-center justify-between">
        <h2 id="org-invitations" className="flex items-center gap-2 font-heading text-base font-semibold">
          <Mail className="h-5 w-5" />
          Invitations
        </h2>
        <Button size="sm" variant="outline" onClick={() => setInviting(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Invite
        </Button>
      </div>

      {invitations === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : invitations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No invitations. Invite the owner and they make their own login, then set up their salon.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border bg-card">
          {invitations.map((inv) => {
            const status = inviteStatus({
              acceptedAt: inv.acceptedAt ? new Date(inv.acceptedAt) : null,
              revokedAt: inv.revokedAt ? new Date(inv.revokedAt) : null,
              expiresAt: new Date(inv.expiresAt),
            });
            const { label, variant } = STATUS[status];
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="invitation">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.role === "admin" ? "Owner" : "Staff"} · {inv.language === "vi" ? "Tiếng Việt" : "English"} ·{" "}
                    {inv.delivery === "email" ? (inv.remindedAt ? "emailed, reminded" : "emailed") : "link copied"} ·{" "}
                    {status === "accepted"
                      ? `joined ${format(new Date(inv.acceptedAt!), "d MMM yyyy")}`
                      : status === "pending"
                        ? `link works until ${format(new Date(inv.expiresAt), "d MMM, HH:mm")}`
                        : `sent ${format(new Date(inv.createdAt), "d MMM yyyy")}`}
                  </p>
                </div>
                <Badge variant={variant}>{label}</Badge>
                {status !== "accepted" && canEmail && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      send(`/api/admin/organizations/${orgId}/invitations/${inv.id}`, { delivery: "email" }, inv.email)
                    }
                  >
                    <Send className="mr-1.5 h-4 w-4" />
                    Email again
                  </Button>
                )}
                {status !== "accepted" && (
                  <Button
                    size="sm"
                    variant={canEmail ? "ghost" : "outline"}
                    disabled={busy}
                    onClick={() =>
                      send(`/api/admin/organizations/${orgId}/invitations/${inv.id}`, { delivery: "link" }, inv.email)
                    }
                  >
                    <Link2 className="mr-1.5 h-4 w-4" />
                    Copy a new link
                  </Button>
                )}
                {status === "pending" && (
                  <Button size="sm" variant="ghost" onClick={() => revoke(inv)}>
                    Withdraw
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription>
              {canEmail
                ? "We email them a link to make their login. They choose their own password."
                : "You'll get a link to send them. They choose their own password."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor="invite-email" className="text-xs font-medium">Email</label>
              <Input
                id="invite-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="owner@salon.co.uk"
                className="mt-1"
              />
            </div>
            <div>
              <span className="text-xs font-medium">They are</span>
              <div className="mt-1 flex gap-2">
                {[
                  { value: "admin", label: "The owner" },
                  { value: "member", label: "Staff" },
                ].map((r) => (
                  <Button
                    key={r.value}
                    type="button"
                    size="sm"
                    variant={form.role === r.value ? "default" : "outline"}
                    aria-pressed={form.role === r.value}
                    onClick={() => setForm({ ...form, role: r.value })}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">Their language</span>
              <LanguageFlags value={form.language} onChange={(language) => setForm({ ...form, language })} />
            </div>
            {canEmail && (
              <div>
                <label htmlFor="invite-note" className="text-xs font-medium">A note from you (optional)</label>
                <Textarea
                  id="invite-note"
                  value={form.note}
                  maxLength={600}
                  rows={3}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="mt-1"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            {canEmail && (
              <Button variant="ghost" onClick={() => invite("link")} disabled={busy || !form.email.trim()}>
                Copy a link instead
              </Button>
            )}
            <Button onClick={() => invite(canEmail ? "email" : "link")} disabled={busy || !form.email.trim()}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {canEmail ? "Email invitation" : "Make link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteLinkDialog link={shown?.link ?? null} email={shown?.email ?? ""} onClose={() => setShown(null)} />
    </section>
  );
}
