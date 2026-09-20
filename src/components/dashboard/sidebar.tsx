"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Phone,
  MessageCircle,
  Globe,
  Users,
  CalendarClock,
  CalendarCheck,
  Settings,
  Bot,
  LogOut,
  Building2,
  Shield,
  TrendingUp,
  CalendarDays,
  Receipt,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api-fetch";

type FeatureKey = "voice" | "chatbot" | "whatsapp" | "instagram" | "facebook" | null;

const navItems: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  requires?: FeatureKey | FeatureKey[];
}> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calls", label: "Call History", icon: Phone, requires: "voice" },
  {
    href: "/conversations",
    label: "Conversations",
    icon: MessageCircle,
    requires: ["chatbot", "whatsapp", "instagram", "facebook"],
  },
  { href: "/websites", label: "Websites", icon: Globe, requires: "chatbot" },
  {
    href: "/insights",
    label: "Insights",
    icon: TrendingUp,
    requires: "chatbot",
  },
  { href: "/leads", label: "Leads", icon: Users },
  {
    href: "/calendar",
    label: "Diary",
    icon: CalendarDays,
    requires: "voice",
  },
  {
    href: "/appointments",
    label: "Appointments",
    icon: CalendarCheck,
    requires: "voice",
  },
  { href: "/sales", label: "Sales", icon: Receipt, requires: "voice" },
  {
    href: "/callbacks",
    label: "Callbacks",
    icon: CalendarClock,
    requires: "voice",
  },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

export function Sidebar({
  open = false,
  onNavigate,
}: {
  /** Drawer state below md. Ignored from md up, where the rail is static. */
  open?: boolean;
  /** Close the drawer after a tap that navigates. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const asOrg = searchParams.get("asOrg");
  const { data: session } = useSession();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);

  const isSuperAdmin = session?.user?.role === "superAdmin";
  const user = session?.user;

  const [features, setFeatures] = useState<{
    chatbotEnabled: boolean;
    whatsappEnabled: boolean;
    voiceEnabled: boolean;
    instagramEnabled: boolean;
    facebookEnabled: boolean;
  } | null>(null);

  // Super-admins: load all orgs for the switcher
  useEffect(() => {
    if (!isSuperAdmin) return;
    fetch("/api/admin/organizations")
      .then((r) => r.json())
      .then((d) =>
        setOrgs(
          (d.organizations || []).map((o: OrgSummary) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
          }))
        )
      )
      .catch(() => {});
  }, [isSuperAdmin]);

  // Load feature flags for the current org (respects ?asOrg for super-admins
  // automatically via apiFetch)
  useEffect(() => {
    if (!session?.user?.id) return;
    apiFetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.settings) return;
        setFeatures({
          chatbotEnabled: !!d.settings.chatbotEnabled,
          whatsappEnabled: !!d.settings.whatsappEnabled,
          voiceEnabled: !!d.settings.voiceEnabled,
          instagramEnabled: !!d.settings.instagramEnabled,
          facebookEnabled: !!d.settings.facebookEnabled,
        });
      })
      .catch(() => {});
  }, [session?.user?.id, asOrg]);

  const activeOrgId = asOrg || session?.user?.organizationId || null;
  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  function switchOrg(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id && id !== session?.user?.organizationId) {
      params.set("asOrg", id);
    } else {
      params.delete("asOrg");
    }
    // Full reload is intentional: every fetched API route reads
    // `?asOrg` from the URL, and hard-navigating is the simplest way to
    // ensure server components, middleware, and apiFetch all agree on the
    // new scope. This is not a closed-over variable mutation.
    // eslint-disable-next-line react-hooks/immutability
    window.location.href = `${pathname}?${params.toString()}`;
  }

  // Preserve asOrg query param in all nav links
  const navSuffix = asOrg ? `?asOrg=${asOrg}` : "";

  return (
    <aside
      className={cn(
        "w-64 bg-card text-foreground flex flex-col border-r border-border shrink-0",
        // Off-canvas below md, static beside the content from md up. It used to
        // be neither: a permanent 256px column that took two thirds of a phone
        // screen and left the conversation list a sliver — which is also why
        // the conversations page's own mobile layout never got to run.
        "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200 md:static md:w-64 md:max-w-none md:translate-x-0 md:transition-none",
        open ? "translate-x-0" : "-translate-x-full",
        "overflow-y-auto md:min-h-screen"
      )}
    >
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
            <Bot className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm tracking-tight truncate">
              {activeOrg?.name ||
                session?.user?.organizationName ||
                "Call Assistant"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isSuperAdmin && asOrg ? "viewing as super-admin" : "AI CRM"}
            </p>
          </div>
        </div>

        {/* Super-admin org switcher */}
        {isSuperAdmin && orgs.length > 0 && (
          <div className="mt-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs text-foreground/80 bg-muted hover:bg-accent border border-border">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3 h-3" />
                  Switch org
                </span>
                <span className="text-muted-foreground truncate">
                  {activeOrg?.slug || "—"}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Organizations</div>
                <DropdownMenuSeparator />
                {orgs.map((o) => (
                  <DropdownMenuItem
                    key={o.id}
                    onClick={() => switchOrg(o.id)}
                    className="flex flex-col items-start"
                  >
                    <span className="text-sm">{o.name}</span>
                    <span className="text-[10px] text-muted-foreground">{o.slug}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems
          .filter((item) => isNavVisible(item, features))
          .map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href + navSuffix}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                  isActive
                    ? "bg-blue-600/15 text-blue-400 border border-blue-500/20"
                    : "text-muted-foreground hover:text-white hover:bg-accent/50"
                )}
              >
                <item.icon
                  className={cn("w-4 h-4", isActive && "text-blue-400")}
                />
                {item.label}
              </Link>
            );
          })}

        {isSuperAdmin && (
          <Link
            href={`/admin/organizations${navSuffix}`}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mt-4 border-t border-border pt-4",
              pathname?.startsWith("/admin")
                ? "text-amber-400"
                : "text-muted-foreground hover:text-amber-400 hover:bg-accent/50"
            )}
          >
            <Shield className="w-4 h-4" />
            Admin
          </Link>
        )}
      </nav>

      {/* User menu */}
      <div className="p-3 border-t border-border">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-accent/50">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold">
                {(user.name || user.email || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm truncate">{user.name || user.email}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <div className="px-2 py-1.5 text-xs">
                <p className="font-medium">{user.name || user.email}</p>
                <p className="text-[10px] text-muted-foreground">{user.role}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => (window.location.href = "/settings/account")}>
                <Settings className="w-4 h-4 mr-2" />
                Account settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-2 h-2 bg-slate-600 rounded-full" />
            <span className="text-xs text-muted-foreground">Not signed in</span>
          </div>
        )}
      </div>
    </aside>
  );
}

type NavItem = {
  href: string;
  requires?: FeatureKey | FeatureKey[];
};
type Flags = {
  chatbotEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  instagramEnabled: boolean;
  facebookEnabled: boolean;
};

function isNavVisible(item: NavItem, features: Flags | null): boolean {
  // No feature requirement → always visible
  if (!item.requires) return true;
  // Flags not loaded yet → show nothing feature-gated (avoids flash)
  if (!features) return false;

  const reqs = Array.isArray(item.requires) ? item.requires : [item.requires];
  // Visible if ANY of the required features is enabled.
  return reqs.some((r) => {
    if (r === "chatbot") return features.chatbotEnabled;
    if (r === "whatsapp") return features.whatsappEnabled;
    if (r === "voice") return features.voiceEnabled;
    if (r === "instagram") return features.instagramEnabled;
    if (r === "facebook") return features.facebookEnabled;
    return true;
  });
}
