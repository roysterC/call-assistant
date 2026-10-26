"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { signOutOfDevice } from "@/lib/push-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Languages, Lock, User as UserIcon, LogOut } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";
import { DeviceAlertsCard } from "@/components/notifications/device-alerts-card";
import { LanguagePicker } from "@/components/i18n/language-picker";
import { useT } from "@/components/providers/language-provider";
import type { MessageKey } from "@/lib/i18n";

const ROLE_LABEL: Record<string, MessageKey> = {
  superAdmin: "account.roleSuperAdmin",
  admin: "account.roleAdmin",
  member: "account.roleMember",
};

export default function AccountSettingsPage() {
  const { data: session } = useSession();
  const me = useMe();
  const { t } = useT();

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
        text: t("account.passwordTooShort"),
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("account.passwordMismatch") });
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
        setMessage({ type: "error", text: err.error || t("account.passwordFailed") });
        return;
      }
      // Changing the password signed out every session, this one included;
      // sign back in with the new password so the user carries on.
      const email = session?.user?.email;
      const again = email
        ? await signIn("credentials", { email, password: newPassword, redirect: false })
        : null;
      if (!again || again.error) {
        window.location.href = "/login";
        return;
      }
      setMessage({ type: "success", text: t("account.passwordChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("account.title")}</h1>


      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserIcon className="w-5 h-5" />
            {t("account.profile")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("account.name")}</label>
            <p className="text-sm mt-1">{session?.user?.name || "—"}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("account.email")}</label>
            <p className="text-sm mt-1">{session?.user?.email || "—"}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("account.role")}</label>
            <p className="text-sm mt-1">
              {t(ROLE_LABEL[me?.role ?? session?.user?.role ?? "member"] ?? "account.roleMember")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Languages className="w-5 h-5" />
            {t("language.label")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LanguagePicker />
          <p className="text-xs text-muted-foreground">{t("language.hint")}</p>
        </CardContent>
      </Card>

      <DeviceAlertsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Lock className="w-5 h-5" />
            {t("account.changePassword")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("account.currentPassword")}</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("account.newPassword")}</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {t("account.minLength")}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">{t("account.confirmPassword")}</label>
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
                    ? "text-tea-green-200"
                    : "text-rose-600"
                }`}
              >
                {message.text}
              </p>
            )}

            <Button type="submit" disabled={saving}>
              {saving ? t("account.saving") : t("account.changePassword")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Button
            variant="outline"
            onClick={() => void signOutOfDevice()}
          >
            <LogOut className="w-4 h-4 mr-2" />
            {t("account.signOut")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
