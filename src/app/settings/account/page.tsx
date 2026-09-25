"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, User as UserIcon, LogOut } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";

export default function AccountSettingsPage() {
  const { data: session } = useSession();
  const me = useMe();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 8) {
      setMessage({
        type: "error",
        text: "New password must be at least 8 characters",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New passwords do not match" });
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to change password" });
        return;
      }
      setMessage({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // A stylist replacing a temporary password goes straight on to the
      // diary; a full reload so the new state is read fresh everywhere.
      if (me?.mustChangePassword) window.location.href = "/calendar";
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-muted-foreground mt-1">
          Manage your personal account
        </p>
      </div>

      {me?.mustChangePassword && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Choose your own password to get started</p>
          <p className="text-muted-foreground mt-1">
            You signed in with a temporary password. Enter it as your current
            password below, then pick a new one only you know.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserIcon className="w-5 h-5" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <p className="text-sm mt-1">{session?.user?.name || "—"}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <p className="text-sm mt-1">{session?.user?.email || "—"}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Role</label>
            <p className="text-sm mt-1 capitalize">
              {session?.user?.role || "member"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Change password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Current password</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">New password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Minimum 8 characters
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Confirm new password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="mt-1"
              />
            </div>

            {message && (
              <p
                className={`text-xs ${
                  message.type === "success"
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`}
              >
                {message.text}
              </p>
            )}

            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Button
            variant="outline"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
