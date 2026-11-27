import React from "react";
import { Link, Outlet, createFileRoute, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  BatteryFull,
  CalendarClock,
  CircleDot,
  ClipboardList,
  LogOut,
  Menu,
  Search,
  Settings,
  Sparkles,
  Truck,
  UserCheck,
  Warehouse,
  Route as RouteIcon,
} from "lucide-react";

import { fetchCurrentUser, performLogout, useAuth } from "@/shared/api/auth";
import { useHome, useSyncStatus } from "@/shared/api/queries";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { fmtNumber } from "@/shared/lib/numbers";
import { Omnisearch, openOmnisearch } from "@/widgets/shell/Omnisearch";
import { SyncIndicator } from "@/widgets/shell/SyncIndicator";
import { UpdateBanner } from "@/widgets/shell/UpdateBanner";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const user = await fetchCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: AppShell,
});

const NAV_MAIN = [
  { to: "/", key: "nav.home", icon: Warehouse, exact: true },
  { to: "/trucks", key: "nav.trucks", icon: Truck, exact: false },
  { to: "/wo", key: "nav.workOrders", icon: ClipboardList, exact: false },
  { to: "/due", key: "nav.due", icon: CalendarClock, exact: false },
  { to: "/tires", key: "nav.tires", icon: CircleDot, exact: false },
  { to: "/batteries", key: "nav.batteries", icon: BatteryFull, exact: false },
  { to: "/stock/movements", key: "nav.movements", icon: ArrowLeftRight, exact: false },
  { to: "/attendance", key: "nav.attendance", icon: UserCheck, exact: false },
] as const;

const NAV_TOOLS = [
  { to: "/fees", key: "nav.fees", icon: RouteIcon, exact: false },
  { to: "/ai", key: "nav.ai", icon: Sparkles, exact: false },
  { to: "/settings", key: "nav.settings", icon: Settings, exact: false },
] as const;

/** App shell. On a wide window the sidebar is always there; on a narrow one
 * (a phone, a small tablet) it becomes a drawer behind a menu button, so the
 * page has the whole width. The footer always shows who is signed in — this
 * is a shared garage PC. */
function AppShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const home = useHome();
  const sync = useSyncStatus();
  const overdue = home.data?.due_counts.overdue ?? 0;
  const [drawer, setDrawer] = React.useState(false);
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Any navigation closes the drawer.
  React.useEffect(() => setDrawer(false), [path]);

  const initial = (user?.name || user?.email || "؟").trim().charAt(0);
  const unsent = sync.data?.pending ?? 0;

  const logout = () => {
    setLoggingOut(true);
    void performLogout()
      .then(() => {
        setUser(null);
        return navigate({ to: "/login" });
      })
      .finally(() => {
        setLoggingOut(false);
        setConfirmLogout(false);
      });
  };

  const navItem = ({
    to,
    key,
    icon: Icon,
    exact,
  }: {
    to: string;
    key: string;
    icon: typeof Truck;
    exact: boolean;
  }) => (
    <Link
      key={to}
      to={to}
      activeOptions={{ exact }}
      className="group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground [&.active]:bg-primary/10 [&.active]:font-bold [&.active]:text-primary"
    >
      <span className="absolute inset-y-2 start-0 hidden w-1 rounded-full bg-primary group-[.active]:block" />
      <Icon className="h-[18px] w-[18px] flex-none" />
      <span className="min-w-0 flex-1 truncate">{t(key)}</span>
      {key === "nav.due" && overdue > 0 && (
        <span className="flex-none rounded-full bg-status-overdue-soft px-2 py-0.5 text-xs font-semibold text-status-overdue tabular">
          {fmtNumber(overdue, i18n.language)}
        </span>
      )}
    </Link>
  );

  const sidebar = (
    <>
      <Link to="/" className="flex items-center gap-2.5 px-5 pb-4 pt-6">
        <div className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-primary text-primary-foreground shadow-sm">
          <Truck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold leading-tight">{t("app.name")}</div>
          <div className="truncate text-xs text-muted-foreground">{t("app.tagline")}</div>
        </div>
      </Link>

      <div className="px-3 pb-3">
        <Omnisearch />
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label={t("nav.main")}>
        {NAV_MAIN.map(navItem)}
        <div className="mx-3 my-3 border-t" />
        {NAV_TOOLS.map(navItem)}
      </nav>

      <div className="space-y-1 border-t p-3">
        <SyncIndicator />
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="grid h-9 w-9 flex-none place-items-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold">{user?.name || user?.email}</div>
            <div className="truncate text-xs text-muted-foreground" dir="ltr">
              {user?.email}
            </div>
          </div>
          <button
            type="button"
            title={t("nav.logout")}
            aria-label={t("nav.logout")}
            onClick={() => setConfirmLogout(true)}
            className="grid h-10 w-10 flex-none place-items-center rounded-lg text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
          >
            <LogOut className="h-[18px] w-[18px] rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="hidden w-[264px] flex-none flex-col border-e bg-card lg:flex print:hidden">{sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawer(false)}
          />
          <aside className="absolute inset-y-0 start-0 flex w-[min(300px,86vw)] flex-col border-e bg-card shadow-xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b bg-card px-3 py-2 lg:hidden print:hidden">
          <button
            type="button"
            aria-label={t("nav.menu")}
            onClick={() => setDrawer(true)}
            className="grid h-11 w-11 flex-none place-items-center rounded-lg hover:bg-foreground/5"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/" className="min-w-0 flex-1 truncate text-sm font-bold">
            {t("app.name")}
          </Link>
          <button
            type="button"
            aria-label={t("search.placeholder")}
            onClick={() => openOmnisearch()}
            className="grid h-11 w-11 flex-none place-items-center rounded-lg hover:bg-foreground/5"
          >
            <Search className="h-5 w-5" />
          </button>
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          <UpdateBanner />
          <Outlet />
        </main>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title={t("logout.title")}
        description={unsent > 0 ? t("logout.unsent", { n: fmtNumber(unsent, i18n.language) }) : t("logout.body")}
        confirmLabel={t("nav.logout")}
        pending={loggingOut}
        onConfirm={logout}
      />
    </div>
  );
}
