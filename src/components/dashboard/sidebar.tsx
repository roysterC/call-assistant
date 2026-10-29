"use client";

/**
 * The menu. Diary and Conversations, what a salon owner opens all day, sit up
 * front at full size; every other page is under More, and Settings is at the
 * foot (lib/navigation's splitNav decides which is which).
 *
 * From md up it is the floating panel beside the content, folding to a rail
 * of icons. On a phone it is a bar of tabs along the bottom: the pages up
 * front, the assistant, and More, which opens the rest above the bar.
 */

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
  Ellipsis,
  ChevronDown,
  LayoutGrid,
  Mic,
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
import { OPEN_ASSISTANT } from "@/components/voice-booking/assistant";
import type { MessageKey } from "@/lib/i18n";
import {
  DASHBOARD,
  NAV_PAGES,
  isNavShown,
  splitNav,
  type FeatureFlags,
  type NavPage,
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

type NavItem = NavPage & { icon: typeof LayoutDashboard };

const navItems: NavItem[] = NAV_PAGES.map((p) => ({ ...p, icon: ICONS[p.href] ?? LayoutDashboard }));

/** Kikai's own tool, under More with the rest, for super-admins. */
const ADMIN: NavItem = {
  href: "/admin/organizations",
  label: "Admin",
  labelKey: "nav.admin",
  icon: Shield,
};

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

/** Everything the menu needs, fetched once for the panel and the phone's tabs alike. */
function useNavModel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const asOrg = searchParams.get("asOrg");
  const { data: session } = useSession();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  // The role from the database (/api/me), not the login cookie, so a role
  // changed since signing in shows at once. Nothing role-gated is shown
  // until it has loaded.
  const role = useMe()?.role ?? null;
  const isSuperAdmin = role === "superAdmin";

  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  // The counter beside Callbacks.
  const pending = usePendingCallbacks(Boolean(features?.voiceEnabled));
  useEffect(() => {
    // Another organisation (super-admin switcher): its own count.
    callbacksChanged();
  }, [asOrg]);
  // A start page the organisation chose (Settings → Start page) joins the
  // pages up front; left on automatic, it does not.
  const [chosenStart, setChosenStart] = useState<string | null>(null);
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
        setChosenStart(d.settings.startPage ?? null);
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
    window.location.href = `${pathname}?${params.toString()}`;
  }

  const { primary, more, settings } = splitNav(
    navItems.filter((item) => isNavShown(item, features, role)),
    chosenStart
  );
  if (isSuperAdmin) more.push(ADMIN);

  const isActive = (href: string) =>
    href === ADMIN.href ? Boolean(pathname?.startsWith("/admin")) : pathname === href;

  return {
    pathname,
    user: session?.user,
    role,
    isSuperAdmin,
    asOrg,
    orgs,
    activeOrg,
    switchOrg,
    orgName,
    pending,
    primary,
    more,
    settings,
    isActive,
    // Preserve asOrg query param in all nav links
    navSuffix: asOrg ? `?asOrg=${asOrg}` : "",
    /** Something under More is the page open now. */
    inMore: more.some((p) => isActive(p.href)),
  };
}

type NavModel = ReturnType<typeof useNavModel>;

/** The menu, as a panel from md up and as tabs on a phone. */
export function Navigation({
  collapsed = false,
  onToggleCollapsed,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const model = useNavModel();
  return (
    <>
      <Sidebar model={model} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      <MobileTabs model={model} />
    </>
  );
}

const MORE_KEY = "sidebar-more-open";

/** Whether More is open, remembered in this browser; opened for a page that is in it. */
function useMoreOpen(inMore: boolean): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
      if (window.localStorage.getItem(MORE_KEY) === "1") setOpen(true);
    } catch {
      // No storage: start closed.
    }
  }, []);
  // Arriving on a page under More shows where you are.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the page, not render
    if (inMore) setOpen(true);
  }, [inMore]);
  const set = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(MORE_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, but still open for this visit.
    }
  };
  return [open, set];
}

function Sidebar({
  model,
  collapsed,
  onToggleCollapsed,
}: {
  model: NavModel;
  /** Folded to a rail of icons, so a wide screen like the diary gets the room. */
  collapsed: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { user, role, isSuperAdmin, asOrg, orgs, activeOrg, switchOrg, orgName, pending, primary, more, settings } = model;
  /** Hidden on the folded rail. */
  const wide = collapsed ? "hidden" : "";
  /** Hidden on the folded rail but still taking its space, so nothing below moves. */
  const keep = collapsed ? "invisible" : "";
  const { t } = useT();
  const [moreOpen, setMoreOpen] = useMoreOpen(model.inMore);
  const callbacksUnderMore = more.some((p) => p.href === "/callbacks") ? pending : 0;

  return (
    <aside
      className={cn(
        // A panel floating beside the content, inset from the page's edges.
        // Phones have the tabs instead (MobileTabs).
        "hidden md:flex m-3 mr-0 bg-sidebar text-sidebar-foreground flex-col shrink-0 rounded-[28px] shadow-raised transition-[width]",
        collapsed ? "w-[76px]" : "w-64",
        // The menu scrolls on its own between the logo and the account, so
        // those two never leave the panel on a short screen.
        "overflow-hidden"
      )}
    >
      {/*
        Every icon keeps one left edge whether the menu is open or folded, so
        nothing moves when it is toggled; the 76px rail centres them all on
        38px (logo 20 + 36px, menu icons 10 + 18 + 20px, the bigger ones up
        front 10 + 17 + 22px, avatar 10 + 12 + 32px). Vertically the same:
        what the rail hides keeps its space.
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
          <div className={cn("mt-4 w-[216px] whitespace-nowrap", keep)}>
            <OrgSwitcher orgs={orgs} activeSlug={activeOrg?.slug} onSwitch={switchOrg} />
          </div>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 pb-3 space-y-1 [scrollbar-width:thin]">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} model={model} collapsed={collapsed} big />
        ))}

        {more.length > 0 && (
          <>
            <div aria-hidden className="mx-[18px] my-3 h-px bg-sidebar-border" />
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              aria-expanded={moreOpen}
              aria-controls="nav-more"
              title={collapsed ? t("nav.more") : undefined}
              aria-label={
                !moreOpen && callbacksUnderMore
                  ? t("nav.waiting", { label: t("nav.more"), n: callbacksUnderMore })
                  : collapsed
                    ? t("nav.more")
                    : undefined
              }
              className="group relative flex h-11 w-full items-center gap-3 px-[18px] rounded-[14px] text-sm font-medium whitespace-nowrap text-tea-green-400 transition-colors hover:text-cornsilk-500 hover:bg-white/8"
            >
              <span className="relative shrink-0">
                <Ellipsis className="h-5 w-5" strokeWidth={1.75} />
                {/* Callbacks waiting behind a closed More: a dot on the rail. */}
                {!moreOpen && callbacksUnderMore > 0 && collapsed && (
                  <span aria-hidden className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-light-bronze-500 ring-2 ring-sidebar" />
                )}
              </span>
              <span className={cn("flex-1 text-left", wide)}>{t("nav.more")}</span>
              {!moreOpen && callbacksUnderMore > 0 && !collapsed && <Count n={callbacksUnderMore} />}
              <ChevronDown
                aria-hidden
                className={cn("h-4 w-4 shrink-0 transition-transform duration-200", moreOpen && "rotate-180", wide)}
              />
            </button>
            {/* Folds by animating its row height from nothing to its own; inert
                while folded so Tab does not walk through hidden links. */}
            <div
              id="nav-more"
              className={cn(
                "grid transition-[grid-template-rows] duration-200 ease-out",
                moreOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              )}
              inert={!moreOpen}
            >
              <div className="min-h-0 overflow-hidden space-y-0.5">
                {more.map((item) => (
                  <NavLink key={item.href} item={item} model={model} collapsed={collapsed} />
                ))}
              </div>
            </div>
          </>
        )}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-2.5 py-2.5 space-y-0.5">
        {settings && <NavLink item={settings} model={model} collapsed={collapsed} />}
        {onToggleCollapsed && (
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
        )}
      </div>

      {/* User menu */}
      <div className="shrink-0 px-2.5 pt-1 pb-3">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              title={collapsed ? user.name || user.email || undefined : undefined}
              className="w-full flex h-[52px] items-center gap-2.5 px-3 rounded-[14px] transition-colors hover:bg-white/8"
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

function Count({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-light-bronze-500 text-light-bronze-100 text-[11px] font-bold leading-5 text-center tabular-nums"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** One page in the panel: bigger for the pages up front. */
function NavLink({
  item,
  model,
  collapsed,
  big = false,
}: {
  item: NavItem;
  model: NavModel;
  collapsed: boolean;
  big?: boolean;
}) {
  const { t } = useT();
  const active = model.isActive(item.href);
  const badge = item.href === "/callbacks" && model.pending > 0 ? model.pending : 0;
  const label = t(item.labelKey);
  return (
    <Link
      href={item.href + model.navSuffix}
      // The folded rail shows icons only; the name is on hover.
      title={collapsed ? label : undefined}
      aria-label={badge ? t("nav.waiting", { label, n: badge }) : collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-[14px] whitespace-nowrap transition-colors",
        big ? "h-[52px] px-[17px] text-[15px] font-semibold" : "h-10 px-[18px] text-sm font-medium",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : cn(big ? "text-cornsilk-500" : "text-sidebar-foreground", "hover:text-cornsilk-500 hover:bg-white/8")
      )}
    >
      <span className="relative shrink-0">
        <item.icon
          className={cn(
            big ? "w-[22px] h-[22px]" : "w-5 h-5",
            active ? "text-tea-green-700" : big ? "text-tea-green-600" : "text-tea-green-400 group-hover:text-tea-green-700"
          )}
          strokeWidth={big ? 2 : 1.75}
        />
        {/* Something waiting: a dot on the icon on the folded rail; the open
            menu shows the count instead. */}
        {badge > 0 && collapsed && (
          <span aria-hidden className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-light-bronze-500 ring-2 ring-sidebar" />
        )}
      </span>
      <span className={collapsed ? "hidden" : ""}>{label}</span>
      {badge > 0 && !collapsed && <Count n={badge} />}
    </Link>
  );
}

function OrgSwitcher({
  orgs,
  activeSlug,
  onSwitch,
}: {
  orgs: OrgSummary[];
  activeSlug: string | undefined;
  onSwitch: (id: string) => void;
}) {
  const { t } = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs text-sidebar-foreground bg-white/5 hover:bg-white/10 hover:text-cornsilk-500 transition-colors">
        <span className="flex items-center gap-1.5">
          <Building2 className="w-3 h-3" />
          {t("nav.switchOrg")}
        </span>
        <span className="text-sidebar-muted truncate">{activeSlug || "—"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("nav.organizations")}</div>
        <DropdownMenuSeparator />
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onSwitch(o.id)} className="flex flex-col items-start">
            <span className="text-sm">{o.name}</span>
            <span className="text-[10px] text-muted-foreground">{o.slug}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The short names the tabs use where the full one would not fit. */
const TAB_LABEL: Record<string, MessageKey> = { "/conversations": "nav.chats" };

/**
 * A phone's menu: the pages up front, the assistant and More, as tabs along
 * the bottom where a thumb reaches them. More opens the rest just above the
 * bar, so the bar itself stays put and tapping More again closes it.
 */
function MobileTabs({ model }: { model: NavModel }) {
  const { t } = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname, primary, more, settings, pending, navSuffix } = model;
  // The bar holds four or five; any further page up front waits under More.
  const tabs = primary.slice(0, 3);
  const sheet = [...primary.slice(3), ...more, ...(settings ? [settings] : [])];
  const callbacksInSheet = sheet.some((p) => p.href === "/callbacks") ? pending : 0;
  const sheetActive = sheet.some((p) => model.isActive(p.href));

  // Any page change, the sheet's own links included, closes it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the page
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <div className="md:hidden">
      {moreOpen && (
        <>
          <div
            aria-hidden
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-tea-green-100/40 backdrop-blur-[2px] animate-in fade-in-0"
          />
          <div
            id="nav-more-sheet"
            role="region"
            aria-label={t("nav.morePages")}
            className="fixed inset-x-0 z-40 bottom-[calc(4rem+env(safe-area-inset-bottom))] rounded-t-[28px] bg-card px-4 pt-2.5 pb-4 shadow-raised animate-in fade-in-0 slide-in-from-bottom-4 duration-200"
          >
            <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-tea-green-600" />
            <nav aria-label={t("nav.morePages")} className="grid grid-cols-4 gap-1">
              {sheet.map((item) => {
                const active = model.isActive(item.href);
                const badge = item.href === "/callbacks" ? pending : 0;
                const label = t(item.labelKey);
                return (
                  <Link
                    key={item.href}
                    href={item.href + navSuffix}
                    aria-current={active ? "page" : undefined}
                    aria-label={badge ? t("nav.waiting", { label, n: badge }) : undefined}
                    className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-center text-xs font-medium text-foreground"
                  >
                    <span
                      className={cn(
                        "relative flex h-12 w-12 items-center justify-center rounded-2xl",
                        active ? "bg-primary text-primary-foreground" : "bg-tea-green-900 text-primary"
                      )}
                    >
                      <item.icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
                      {badge > 0 && (
                        <span aria-hidden className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-light-bronze-500 text-light-bronze-100 text-[11px] font-bold leading-5 tabular-nums">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </span>
                    <span className="leading-tight">{label}</span>
                  </Link>
                );
              })}
            </nav>

            {model.isSuperAdmin && model.orgs.length > 0 && (
              <div className="mt-3 rounded-xl bg-sidebar p-1">
                <OrgSwitcher orgs={model.orgs} activeSlug={model.activeOrg?.slug} onSwitch={model.switchOrg} />
              </div>
            )}

            {model.user && (
              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <div className="h-9 w-9 shrink-0 rounded-full bg-tea-green-200 text-cornsilk-500 flex items-center justify-center text-xs font-semibold">
                  {(model.user.name || model.user.email || "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{model.user.name || model.user.email}</p>
                  <Link href="/settings/account" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                    {t("nav.accountSettings")}
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={() => void signOutOfDevice()}
                  className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted"
                >
                  <LogOut className="h-4 w-4" />
                  {t("nav.signOut")}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <nav
        aria-label={t("nav.menu")}
        className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-start border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground"
      >
        {tabs.map((item) => (
          <Tab
            key={item.href}
            href={item.href + navSuffix}
            icon={item.icon}
            label={t(TAB_LABEL[item.href] ?? item.labelKey)}
            active={model.isActive(item.href) && !moreOpen}
          />
        ))}
        <Tab
          icon={Mic}
          label={t("nav.assistant")}
          onClick={() => {
            setMoreOpen(false);
            window.dispatchEvent(new Event(OPEN_ASSISTANT));
          }}
        />
        {sheet.length > 0 && (
          <Tab
            icon={LayoutGrid}
            label={t("nav.more")}
            active={moreOpen || sheetActive}
            expanded={moreOpen}
            dot={callbacksInSheet > 0}
            dotLabel={callbacksInSheet > 0 ? t("nav.callbacksWaiting", { n: callbacksInSheet }) : undefined}
            onClick={() => setMoreOpen(!moreOpen)}
          />
        )}
      </nav>
    </div>
  );
}

/** One tab on the phone's bar: a link, or a button for the assistant and More. */
function Tab({
  href,
  icon: Icon,
  label,
  active = false,
  expanded,
  dot = false,
  dotLabel,
  onClick,
}: {
  href?: string;
  icon: typeof LayoutDashboard;
  label: string;
  active?: boolean;
  expanded?: boolean;
  dot?: boolean;
  dotLabel?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors",
          active ? "bg-sidebar-accent text-cornsilk-500" : "text-tea-green-400"
        )}
      >
        <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2 : 1.75} />
        {dot && (
          <span aria-hidden className="absolute top-0.5 right-2.5 h-2.5 w-2.5 rounded-full bg-light-bronze-500 ring-2 ring-sidebar" />
        )}
      </span>
      <span className={cn("text-[11px] leading-none", active ? "font-semibold text-cornsilk-500" : "font-medium")}>{label}</span>
      {dotLabel && <span className="sr-only">{dotLabel}</span>}
    </>
  );
  const className = "flex h-16 flex-1 flex-col items-center justify-center gap-1 min-w-0";
  return href ? (
    <Link href={href} aria-current={active ? "page" : undefined} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-expanded={expanded} className={className}>
      {body}
    </button>
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
