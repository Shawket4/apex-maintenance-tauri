import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Truck,
  Warehouse,
  CalendarClock,
  CircleDot,
  Sparkles,
  Settings,
  LogOut,
} from "lucide-react";

import { fetchCurrentUser, performLogout, useAuth } from "@/shared/api/auth";
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

const NAV = [
  { to: "/", key: "nav.home", icon: Warehouse, exact: true },
  { to: "/trucks", key: "nav.trucks", icon: Truck },
  { to: "/due", key: "nav.due", icon: CalendarClock },
  { to: "/tires", key: "nav.tires", icon: CircleDot },
  { to: "/ai", key: "nav.ai", icon: Sparkles },
  { to: "/settings", key: "nav.settings", icon: Settings },
] as const;

function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 flex-col border-e bg-card/60 backdrop-blur print:hidden">
        <div className="flex items-center gap-2 px-5 pb-4 pt-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">{t("app.name")}</div>
            <div className="text-xs text-muted-foreground">{t("app.subtitle")}</div>
          </div>
        </div>

        <div className="px-3 pb-2">
          <Omnisearch />
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, key, icon: Icon, ...rest }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: "exact" in rest && rest.exact }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:font-semibold [&.active]:text-primary"
            >
              <Icon className="h-4 w-4" />
              {t(key)}
            </Link>
          ))}
        </nav>

        <div className="space-y-1 border-t p-3">
          <SyncIndicator />
          <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">{user?.name || user?.email}</div>
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
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
