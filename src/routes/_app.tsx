import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  CircleDot,
  LogOut,
  Settings,
  Sparkles,
  Truck,
  Warehouse,
} from "lucide-react";

import { fetchCurrentUser, performLogout, useAuth } from "@/shared/api/auth";
import { useHome } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { Omnisearch } from "@/widgets/shell/Omnisearch";
import { SyncIndicator } from "@/widgets/shell/SyncIndicator";

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
  { to: "/due", key: "nav.due", icon: CalendarClock, exact: false },
  { to: "/tires", key: "nav.tires", icon: CircleDot, exact: false },
] as const;

const NAV_TOOLS = [
  { to: "/ai", key: "nav.ai", icon: Sparkles, exact: false },
  { to: "/settings", key: "nav.settings", icon: Settings, exact: false },
] as const;

/** Sidebar shell, rebuilt on the synced design system: brand, omnisearch,
 * two nav groups (live overdue badge on المستحق), honest sync state and the
 * user block pinned to the footer — a shared garage PC always shows who is
 * logged in. */
function AppShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = useHome();
  const overdue = home.data?.due_counts.overdue ?? 0;

  const initial = (user?.name || user?.email || "؟").trim().charAt(0);

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
      className="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground [&.active]:bg-primary/10 [&.active]:font-bold [&.active]:text-primary"
    >
      <span className="absolute inset-y-2 start-0 hidden w-1 rounded-full bg-primary group-[.active]:block" />
      <Icon className="h-4 w-4 flex-none" />
      <span className="min-w-0 flex-1 truncate">{t(key)}</span>
      {key === "nav.due" && overdue > 0 && (
        <span className="flex-none rounded-full bg-status-overdue-soft px-2 py-0.5 text-xs font-semibold text-status-overdue tabular">
          {fmtNumber(overdue, i18n.language)}
        </span>
      )}
    </Link>
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-[264px] flex-none flex-col border-e bg-card print:hidden">
        <Link to="/" className="flex items-center gap-2.5 px-5 pb-4 pt-6">
          <div className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-primary text-primary-foreground shadow-sm">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight">{t("app.name")}</div>
            <div className="truncate text-[11px] text-muted-foreground">{t("app.tagline")}</div>
          </div>
        </Link>

        <div className="px-3 pb-3">
          <Omnisearch />
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV_MAIN.map(navItem)}
          <div className="mx-3 my-3 border-t" />
          {NAV_TOOLS.map(navItem)}
        </nav>

        <div className="space-y-1 border-t p-3">
          <SyncIndicator />
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div
              title={user?.email ?? ""}
              className="grid h-8 w-8 flex-none place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
            >
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold">{user?.name || user?.email}</div>
              <div className="truncate text-[11px] text-muted-foreground" dir="ltr">
                {user?.email}
              </div>
            </div>
            <button
              title={t("nav.logout")}
              aria-label={t("nav.logout")}
              onClick={() => {
                void performLogout().then(() => navigate({ to: "/login" }));
              }}
              className="flex-none rounded-lg p-2 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
