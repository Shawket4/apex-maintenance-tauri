import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogOut, Truck } from "lucide-react";

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

const NAV = [
  { to: "/", key: "nav.home", exact: true },
  { to: "/trucks", key: "nav.trucks", exact: false },
  { to: "/due", key: "nav.due", exact: false },
  { to: "/tires", key: "nav.tires", exact: false },
  { to: "/ai", key: "nav.ai", exact: false },
  { to: "/settings", key: "nav.settings", exact: false },
] as const;

/** Topbar shell (design sync 2026-07-23): brand · horizontal nav (overdue
 * count on المستحق) · omnisearch · honest sync state · user. Content pages
 * sit on the soft app background. */
function AppShell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = useHome();
  const overdue = home.data?.due_counts.overdue ?? 0;

  const initial = (user?.name || user?.email || "؟").trim().charAt(0);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-[60px] flex-none items-center gap-5 border-b bg-card px-6 print:hidden">
        <Link to="/" className="flex flex-none items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-[15px] font-bold text-primary-foreground">
            <Truck className="h-4.5 w-4.5" />
          </div>
          <div className="whitespace-nowrap text-[13.5px] font-bold">
            {t("app.name")}{" "}
            <span className="text-[11.5px] font-medium text-muted-foreground">
              · {t("app.tagline")}
            </span>
          </div>
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map(({ to, key, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
              className="flex flex-none items-center whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground [&.active]:bg-primary/10 [&.active]:font-bold [&.active]:text-primary"
            >
              {t(key)}
              {key === "nav.due" && overdue > 0 && (
                <span className="ms-2 rounded-full bg-status-overdue-soft px-2 py-0.5 text-xs font-semibold text-status-overdue tabular">
                  {fmtNumber(overdue, i18n.language)}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="w-60 flex-none">
          <Omnisearch />
        </div>

        <SyncIndicator />

        <div className="flex flex-none items-center gap-1.5">
          <div
            title={user?.email ?? ""}
            className="grid h-[30px] w-[30px] place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
          >
            {initial}
          </div>
          <button
            title={t("nav.logout")}
            aria-label={t("nav.logout")}
            onClick={() => {
              void performLogout().then(() => navigate({ to: "/login" }));
            }}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
