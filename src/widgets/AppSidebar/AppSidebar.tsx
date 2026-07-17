/**
 * Left-rail navigation. Phase 2 surface = Dashboard / Vehicles / Service
 * invoices. Maintenance / chassis / tires arrive in later phases.
 *
 * Footer hosts: theme toggle, language toggle, signed-in user info + logout.
 * Matches the reference Falcon-dashboard sidebar style — toggles live in
 * the sidebar, not in a top header.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CircleDot,
  ClipboardList,
  LogOut,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { ThemeToggle } from "@/widgets/ThemeToggle/ThemeToggle";
import { LanguageToggle } from "@/widgets/LanguageToggle/LanguageToggle";
import { useAuth } from "@/shared/api/auth";
import { cn } from "@/shared/lib/cn";

interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: "nav.overview",
    items: [{ to: "/", icon: ClipboardList, labelKey: "nav.due" }],
  },
  {
    titleKey: "nav.fleet",
    items: [
      { to: "/vehicles", icon: Truck, labelKey: "nav.vehicles" },
      { to: "/tires", icon: CircleDot, labelKey: "nav.tires" },
    ],
  },
  {
    titleKey: "nav.operations",
    items: [
      { to: "/service-invoices", icon: Wrench, labelKey: "nav.serviceInvoices" },
      { to: "/diagnostics", icon: Activity, labelKey: "nav.diagnostics" },
    ],
  },
];

export function AppSidebar() {
  const { t, i18n } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();

  const isRtl = i18n.dir() === "rtl";
  const flexDir = isRtl ? "flex-row-reverse" : "flex-row";
  const textAlign = isRtl ? "text-right" : "text-left";

  return (
    <aside 
      className="hidden lg:flex w-60 shrink-0 flex-col border-e border-border bg-card print:hidden"
    >
      {/* Brand */}
      <div className={cn("flex h-14 shrink-0 items-center gap-3 border-b border-border px-4", flexDir)}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Truck className="h-4 w-4" />
        </div>
        <div className={cn("min-w-0 flex-1 leading-tight", textAlign)}>
          <p className="truncate text-sm font-semibold">{t("app.title")}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t("app.subtitle")}
          </p>
        </div>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-4 p-3">
          {NAV_SECTIONS.map((section, idx) => (
            <div key={section.titleKey} className="space-y-1">
              {idx > 0 && <div className="mx-2 my-1 border-t border-border/60" />}
              <h3 className={cn("px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground", textAlign)}>
                {t(section.titleKey)}
              </h3>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    item.to === "/"
                      ? path === "/"
                      : path.startsWith(item.to);
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                          flexDir,
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className={cn("truncate", textAlign)}>{t(item.labelKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="shrink-0 border-t border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
        {user && (
          <div className="px-3 pb-3">
            <div className={cn("flex w-full items-center gap-2 rounded-md border border-border bg-background/60 p-2", flexDir)}>
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary text-xs font-semibold">
                {(user.name || user.email)
                  .trim()
                  .split(/\s+/)
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")}
              </div>
              <div className={cn("min-w-0 flex-1 leading-tight", textAlign)}>
                <p className="truncate text-xs font-semibold">
                  {user.name || user.email}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => logout()}
                title={t("actions.logout")}
                aria-label={t("actions.logout")}
              >
                <LogOut className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
