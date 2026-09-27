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
  FlaskConical,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api-fetch";
import { stylistMayVisit, useMe } from "@/components/providers/me-provider";
import {
  DASHBOARD,
  NAV_PAGES,
  isNavVisible,
  orderForStartPage,
  type FeatureFlags,
} from "@/lib/navigation";

/** Each page's icon; the pages themselves are in src/lib/navigation.ts. */
const ICONS: Record<string, typeof LayoutDashboard> = {
  [DASHBOARD]: LayoutDashboard,
  "/calls": Phone,
  "/conversations": MessageCircle,
  "/websites": Globe,
  "/insights": TrendingUp,
  "/leads": Users,
  "/calendar": CalendarDays,
  "/appointments": CalendarCheck,
  "/sales": Receipt,
  "/callbacks": CalendarClock,
  "/receptionist": FlaskConical,
  "/settings": Settings,
};

const navItems = NAV_PAGES.map((p) => ({ ...p, icon: ICONS[p.href] ?? LayoutDashboard }));

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

export function Sidebar({
  open = false,
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: {
  /** Drawer state below md. Ignored from md up, where the rail is static. */
  open?: boolean;
  /** Close the drawer after a tap that navigates. */
  onNavigate?: () => void;
  /**
   * From md up: folded to a rail of icons, so a wide screen like the diary
   * gets the room. Below md the drawer is always shown in full.
   */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  /** Hidden on the folded rail; always shown in the phone drawer. */
  const wide = collapsed ? "md:hidden" : "";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const asOrg = searchParams.get("asOrg");
  const { data: session } = useSession();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);

  const isSuperAdmin = session?.user?.role === "superAdmin";
  const user = session?.user;
  const me = useMe();

  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  // The organisation's start page goes to the top (Settings → Start page).
  const [startPage, setStartPage] = useState<string | null>(null);

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
        setStartPage(d.startPage ?? null);
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
        "w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shrink-0",
        // Off-canvas below md, static beside the content from md up. It used to
        // be neither: a permanent 256px column that took two thirds of a phone
        // screen and left the conversation list a sliver — which is also why
        // the conversations page's own mobile layout never got to run.
        "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200 md:static md:max-w-none md:translate-x-0 md:transition-[width]",
        collapsed ? "md:w-16" : "md:w-64",
        open ? "translate-x-0" : "-translate-x-full",
        "overflow-y-auto md:min-h-screen"
      )}
    >
      <div className={cn("px-5 pt-6 pb-5", collapsed && "md:px-3.5")}>
        <div className={cn("flex items-center gap-3", collapsed && "md:flex-col")}>
          <BrandMark />
          <div className={cn("min-w-0 flex-1", wide)}>
            <h1 className="font-semibold text-[0.95rem] leading-tight tracking-tight truncate">
              {activeOrg?.name ||
                session?.user?.organizationName ||
                "Call Assistant"}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isSuperAdmin && asOrg ? "viewing as super-admin" : "AI CRM"}
            </p>
          </div>
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              title={collapsed ? "Expand menu" : "Collapse menu"}
              className="hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:text-foreground hover:bg-accent transition-colors"
            >
              {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
            </button>
          )}
        </div>

        {/* Super-admin org switcher */}
        {isSuperAdmin && orgs.length > 0 && (
          <div className={cn("mt-3", wide)}>
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-foreground/80 bg-card hover:bg-accent border border-input">
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

      <nav className={cn("flex-1 px-3 pb-3 space-y-0.5", collapsed && "md:px-2")}>
        <p className={cn("px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80", wide)}>
          Menu
        </p>
        {orderForStartPage(navItems, startPage)
          .filter((item) =>
            // A stylist login's pages are the diary, their bookings and, if
            // allowed, their own takings — whatever the salon has switched on.
            me?.stylist
              ? stylistMayVisit(me, item.href)
              : isNavVisible(item, features) &&
                (!item.ownerOnly || user?.role === "admin" || user?.role === "superAdmin")
          )
          .map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href + navSuffix}
                onClick={onNavigate}
                // The folded rail shows icons only; the name is on hover.
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  collapsed && "md:justify-center md:px-0",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-slate-600 hover:text-foreground hover:bg-accent"
                )}
              >
                <item.icon
                  className={cn(
                    "w-[18px] h-[18px]",
                    isActive
                      ? "text-primary"
                      : "text-slate-400 group-hover:text-slate-600"
                  )}
                />
                <span className={wide}>{item.label}</span>
              </Link>
            );
          })}

        {isSuperAdmin && (
          <Link
            href={`/admin/organizations${navSuffix}`}
            onClick={onNavigate}
            title={collapsed ? "Admin" : undefined}
            aria-label={collapsed ? "Admin" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mt-4",
              collapsed && "md:justify-center md:px-0",
              pathname?.startsWith("/admin")
                ? "bg-amber-50 text-amber-800"
                : "text-slate-600 hover:text-amber-800 hover:bg-amber-50"
            )}
          >
            <Shield className="w-[18px] h-[18px]" />
            <span className={wide}>Admin</span>
          </Link>
        )}
      </nav>

      {/* User menu */}
      <div className={cn("p-3 border-t border-sidebar-border", collapsed && "md:px-2")}>
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              title={collapsed ? user.name || user.email || undefined : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-accent",
                collapsed && "md:justify-center md:px-0"
              )}
            >
              <div className="w-8 h-8 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">
                {(user.name || user.email || "?")[0].toUpperCase()}
              </div>
              <div className={cn("flex-1 min-w-0 text-left", wide)}>
                <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                <p className="text-[11px] text-muted-foreground truncate">
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
            <div className="w-2 h-2 bg-slate-300 rounded-full" />
            <span className={cn("text-xs text-muted-foreground", wide)}>Not signed in</span>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The product mark: a rounded indigo tile. Shared with the mobile header and
 * the sign-in page so the three never drift apart.
 */
export function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "w-7 h-7 rounded-lg" : size === "lg" ? "w-11 h-11 rounded-xl" : "w-9 h-9 rounded-xl";
  const icon = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-6 h-6" : "w-5 h-5";
  return (
    <div
      className={cn(
        box,
        "shrink-0 flex items-center justify-center text-white bg-gradient-to-br from-indigo-500 to-violet-600 shadow-[0_2px_6px_-1px_rgb(79_70_229/0.45)]"
      )}
    >
      <Bot className={icon} />
    </div>
  );
}
