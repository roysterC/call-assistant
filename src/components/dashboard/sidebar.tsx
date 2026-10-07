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
  Contact,
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
import { callbacksChanged, usePendingCallbacks } from "@/lib/use-pending-callbacks";
import { apiFetch } from "@/lib/api-fetch";
import { useMe } from "@/components/providers/me-provider";
import {
  DASHBOARD,
  NAV_PAGES,
  isNavAllowed,
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
  "/clients": Contact,
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
  /** Hidden on the folded rail but still taking its space, so nothing below moves. */
  const keep = collapsed ? "md:invisible" : "";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const asOrg = searchParams.get("asOrg");
  const { data: session } = useSession();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);

  const user = session?.user;
  // The role from the database (/api/me), not the login cookie, so a role
  // changed since signing in shows at once. Nothing role-gated is shown
  // until it has loaded.
  const role = useMe()?.role ?? null;
  const isSuperAdmin = role === "superAdmin";

  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  // The red counter beside Callbacks.
  const pending = usePendingCallbacks(Boolean(features?.voiceEnabled));
  useEffect(() => {
    // Another organisation (super-admin switcher): its own count.
    callbacksChanged();
  }, [asOrg]);
  // The organisation's start page goes to the top (Settings → Start page).
  const [startPage, setStartPage] = useState<string | null>(null);
  // The organisation's name, from the same request as the menu. Until it
  // arrives the header stays blank: showing the login's own organisation or a
  // placeholder first made the name visibly change on every reload.
  const [orgName, setOrgName] = useState<string | null>(null);

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
        setOrgName(d?.organizationName || session?.user?.organizationName || "Call Assistant");
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
      .catch(() => setOrgName(session?.user?.organizationName || "Call Assistant"));
  }, [session?.user?.id, session?.user?.organizationName, asOrg]);

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
        "overflow-y-auto overflow-x-hidden md:min-h-screen"
      )}
    >
      {/*
        Every icon keeps one left edge whether the menu is open or folded, so
        nothing moves when it is toggled; the 64px rail is sized to centre them
        there (logo 14px + 36px, menu icons 8 + 15px + 18px, avatar 8 + 8px +
        32px). Centring them instead tied their position to the width, which
        animates, so they slid across and back on every fold. Vertically the
        same: what the rail hides keeps its space, and the fold button has its
        own row rather than stacking under the logo.
      */}
      <div className="px-3.5 pt-6 pb-5">
        <div className="flex h-10 items-center gap-3">
          <BrandMark />
          <div className={cn("min-w-0 flex-1", wide)}>
            {/* Held blank, at full height, until the name and role are known. */}
            <h1 className="font-semibold text-[0.95rem] leading-tight tracking-tight truncate">
              {orgName ?? <span className="invisible">Loading</span>}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {role ? (
                isSuperAdmin && asOrg ? "viewing as super-admin" : "AI CRM"
              ) : (
                <span className="invisible">AI CRM</span>
              )}
            </p>
          </div>
        </div>

        {/* Super-admin org switcher */}
        {isSuperAdmin && orgs.length > 0 && (
          // Its full width even on the rail, where it is invisible: squeezed into
          // 36px its text wrapped and the box grew, pushing the menu down.
          <div className={cn("mt-3 w-full whitespace-nowrap md:w-[228px]", keep)}>
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

      <nav className="flex-1 px-2 pb-3 space-y-0.5">
        <p className={cn("px-[15px] pb-2 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap text-muted-foreground/80", keep)}>
          Menu
        </p>
        {orderForStartPage(navItems, startPage)
          .filter(
            (item) =>
              isNavVisible(item, features) && isNavAllowed(item, role)
          )
          .map((item) => {
            const isActive = pathname === item.href;
            const badge = item.href === "/callbacks" && pending > 0 ? pending : 0;
            return (
              <Link
                key={item.href}
                href={item.href + navSuffix}
                onClick={onNavigate}
                // The folded rail shows icons only; the name is on hover.
                title={collapsed ? item.label : undefined}
                aria-label={
                  badge ? `${item.label}, ${badge} waiting` : collapsed ? item.label : undefined
                }
                className={cn(
                  "group relative flex h-9 items-center gap-3 px-[15px] rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
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
                {badge > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      "ml-auto min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-semibold leading-5 text-center tabular-nums",
                      // On the folded rail, a smaller counter on the icon's corner.
                      collapsed && "md:absolute md:top-0.5 md:right-2 md:ml-0 md:min-w-4 md:h-4 md:px-1 md:text-[10px] md:leading-4"
                    )}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
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
              "flex h-9 items-center gap-3 px-[15px] rounded-lg text-sm font-medium whitespace-nowrap transition-colors mt-4",
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

      {/* Folding sits on its own row, its icon in line with the menu's. */}
      {onToggleCollapsed && (
        <div className="hidden px-2 pb-2 md:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            className="group flex h-9 w-full items-center gap-3 whitespace-nowrap rounded-lg px-[15px] text-sm font-medium text-slate-500 transition-colors hover:bg-accent hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px] text-slate-400 group-hover:text-slate-600" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px] text-slate-400 group-hover:text-slate-600" />
            )}
            <span className={wide}>Collapse menu</span>
          </button>
        </div>
      )}

      {/* User menu */}
      <div className="px-2 py-3 border-t border-sidebar-border">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              title={collapsed ? user.name || user.email || undefined : undefined}
              className={cn(
                "w-full flex h-[52px] items-center gap-2.5 px-2 rounded-lg hover:bg-accent"
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
                <p className="text-[10px] text-muted-foreground">{role ?? user.role}</p>
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
