"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { signOutOfDevice } from "@/lib/push-client";
import { useT } from "@/components/providers/language-provider";
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
  isNavShown,
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
  const { t } = useT();
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
    // ensure server components, the proxy, and apiFetch all agree on the
    // new scope. This is not a closed-over variable mutation.
    // eslint-disable-next-line react-hooks/immutability
    window.location.href = `${pathname}?${params.toString()}`;
  }

  // Preserve asOrg query param in all nav links
  const navSuffix = asOrg ? `?asOrg=${asOrg}` : "";

  return (
    <aside
      className={cn(
        // A panel floating on the page, inset from its edges, with round
        // corners: on a phone as the drawer, from md up beside the content.
        "bg-sidebar text-sidebar-foreground flex flex-col shrink-0 rounded-[28px] shadow-raised",
        // Off-canvas below md, static beside the content from md up. It used to
        // be neither: a permanent 256px column that took two thirds of a phone
        // screen and left the conversation list a sliver — which is also why
        // the conversations page's own mobile layout never got to run.
        "fixed inset-y-2 left-2 z-50 w-72 max-w-[85vw] transition-transform duration-200 md:static md:m-3 md:mr-0 md:max-w-none md:translate-x-0 md:transition-[width]",
        collapsed ? "md:w-[76px]" : "md:w-64",
        open ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]",
        // The menu scrolls on its own between the logo and the account, so
        // those two never leave the panel on a short screen.
        "overflow-hidden"
      )}
    >
      {/*
        Every icon keeps one left edge whether the menu is open or folded, so
        nothing moves when it is toggled; the 76px rail centres them all on
        38px (logo 20 + 36px, menu icons 10 + 18 + 20px, avatar 10 + 12 +
        32px). Centring them instead tied their position to the width, which
        animates, so they slid across and back on every fold. Vertically the
        same: what the rail hides keeps its space, and the fold button has its
        own row rather than stacking under the logo.
      */}
      <div className="shrink-0 px-5 pt-6 pb-5">
        <div className="flex h-10 items-center gap-3">
          <BrandMark />
          <div className={cn("min-w-0 flex-1", wide)}>
            {/* Held blank, at full height, until the name and role are known. */}
            <h1 className="font-semibold text-[0.95rem] leading-tight tracking-tight truncate text-cornsilk-500">
              {orgName ?? <span className="invisible">{t("nav.loading")}</span>}
            </h1>
            <p className="text-xs text-sidebar-muted mt-0.5">
              {role ? (
                isSuperAdmin && asOrg ? t("nav.viewingAsSuperAdmin") : t("nav.aiCrm")
              ) : (
                <span className="invisible">{t("nav.aiCrm")}</span>
              )}
            </p>
          </div>
        </div>

        {/* Super-admin org switcher */}
        {isSuperAdmin && orgs.length > 0 && (
          // Its full width even on the rail, where it is invisible: squeezed into
          // 36px its text wrapped and the box grew, pushing the menu down.
          <div className={cn("mt-4 w-full whitespace-nowrap md:w-[216px]", keep)}>
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs text-sidebar-foreground bg-white/5 hover:bg-white/10 hover:text-cornsilk-500 transition-colors">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3 h-3" />
                  {t("nav.switchOrg")}
                </span>
                <span className="text-sidebar-muted truncate">
                  {activeOrg?.slug || "—"}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("nav.organizations")}</div>
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

      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 pb-3 space-y-1 [scrollbar-width:thin]">
        <p className={cn("px-[18px] pb-2 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap text-sidebar-muted", keep)}>
          {t("nav.menu")}
        </p>
        {orderForStartPage(navItems, startPage)
          .filter((item) => isNavShown(item, features, role))
          .map((item) => {
            const isActive = pathname === item.href;
            const badge = item.href === "/callbacks" && pending > 0 ? pending : 0;
            const label = t(item.labelKey);
            return (
              <Link
                key={item.href}
                href={item.href + navSuffix}
                onClick={onNavigate}
                // The folded rail shows icons only; the name is on hover.
                title={collapsed ? label : undefined}
                aria-label={
                  badge ? t("nav.waiting", { label, n: badge }) : collapsed ? label : undefined
                }
                className={cn(
                  "group relative flex h-11 items-center gap-3 px-[18px] rounded-[14px] text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:text-cornsilk-500 hover:bg-white/8"
                )}
              >
                <span className="relative shrink-0">
                  <item.icon
                    className={cn(
                      "w-5 h-5",
                      isActive ? "text-tea-green-700" : "text-tea-green-400 group-hover:text-tea-green-700"
                    )}
                    strokeWidth={1.75}
                  />
                  {/* Something waiting: a dot on the icon on the folded rail;
                      the open menu shows the count instead. */}
                  {badge > 0 && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-light-bronze-500 ring-2 ring-sidebar",
                        collapsed ? "hidden md:block" : "hidden"
                      )}
                    />
                  )}
                </span>
                <span className={wide}>{label}</span>
                {badge > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      "ml-auto min-w-5 h-5 px-1.5 rounded-full bg-light-bronze-500 text-light-bronze-100 text-[11px] font-bold leading-5 text-center tabular-nums",
                      wide
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
            title={collapsed ? t("nav.admin") : undefined}
            aria-label={collapsed ? t("nav.admin") : undefined}
            className={cn(
              "flex h-11 items-center gap-3 px-[18px] rounded-[14px] text-sm font-medium whitespace-nowrap transition-colors mt-4",
              pathname?.startsWith("/admin")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:text-cornsilk-500 hover:bg-white/8"
            )}
          >
            <Shield className="w-5 h-5 shrink-0" strokeWidth={1.75} />
            <span className={wide}>{t("nav.admin")}</span>
          </Link>
        )}
      </nav>

      {/* Folding sits on its own row, its icon in line with the menu's. */}
      {onToggleCollapsed && (
        <div className="hidden shrink-0 border-t border-sidebar-border px-2.5 py-2.5 md:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            className="group flex h-11 w-full items-center gap-3 whitespace-nowrap rounded-[14px] px-[18px] text-sm font-medium text-tea-green-400 transition-colors hover:bg-white/8 hover:text-cornsilk-500"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5 shrink-0 text-tea-green-400 group-hover:text-tea-green-700" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="h-5 w-5 shrink-0 text-tea-green-400 group-hover:text-tea-green-700" strokeWidth={1.75} />
            )}
            <span className={wide}>{t("nav.collapse")}</span>
          </button>
        </div>
      )}

      {/* User menu */}
      {/* On a phone, where there is no fold button, the line sits here instead. */}
      <div className="shrink-0 px-2.5 pt-1 pb-3 max-md:border-t max-md:border-sidebar-border max-md:pt-3">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              title={collapsed ? user.name || user.email || undefined : undefined}
              className={cn(
                "w-full flex h-[52px] items-center gap-2.5 px-3 rounded-[14px] transition-colors hover:bg-white/8"
              )}
            >
              <div className="w-8 h-8 shrink-0 rounded-full bg-tea-green-200 text-cornsilk-500 flex items-center justify-center text-xs font-semibold">
                {(user.name || user.email || "?")[0].toUpperCase()}
              </div>
              <div className={cn("flex-1 min-w-0 text-left", wide)}>
                <p className="text-sm font-medium truncate text-cornsilk-500">{user.name || user.email}</p>
                <p className="text-[11px] text-sidebar-muted truncate">
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
                {t("nav.accountSettings")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void signOutOfDevice()}>
                <LogOut className="w-4 h-4 mr-2" />
                {t("nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-2 h-2 bg-tea-green-400 rounded-full" />
            <span className={cn("text-xs text-sidebar-muted", wide)}>{t("nav.notSignedIn")}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The product mark: the Kikai app icon, the same tile as the favicon and the
 * home-screen icon. Shared with the mobile header and the sign-in page so the
 * three never drift apart. `alt=""` where "Kikai" is written beside it.
 */
export function BrandMark({ size = "md", alt = "Kikai" }: { size?: "sm" | "md" | "lg"; alt?: string }) {
  const px = size === "sm" ? 28 : size === "lg" ? 44 : 36;
  // The Kikai app icon: the same tile as the favicon and the home-screen icon.
  // eslint-disable-next-line @next/next/no-img-element -- a fixed-size SVG; nothing to optimise
  return <img src="/brand/kikai-app-icon.svg" alt={alt} width={px} height={px} className="shrink-0" />;
}
