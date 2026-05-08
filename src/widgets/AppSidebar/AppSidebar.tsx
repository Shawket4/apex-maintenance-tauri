/**
 * Left-rail navigation. Phase 2 surface = three items: dashboard, vehicles,
 * invoices. Maintenance / chassis / tires follow in later phases.
 *
 * The active link uses TanStack Router's `useRouterState` to compute the
 * current path so we don't have to maintain a parallel "active route" store.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Receipt,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";

interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
}

const NAV: NavItem[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { to: "/vehicles", icon: Truck, labelKey: "nav.vehicles" },
  { to: "/invoices", icon: Receipt, labelKey: "nav.invoices" },
];

export function AppSidebar() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden lg:flex w-56 shrink-0 flex-col border-e border-border bg-muted/30">
      <nav className="flex flex-col gap-0.5 p-3">
        {NAV.map((item) => {
          const active =
            item.to === "/" ? path === "/" : path.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
