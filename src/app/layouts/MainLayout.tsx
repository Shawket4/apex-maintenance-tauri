import { Link, useNavigate } from "@tanstack/react-router";
import { Truck, Sparkles, CircleDot, CalendarClock, Settings, LogOut } from "lucide-react";
import { performLogout } from "@/shared/api/auth";

const NAV = [
  { to: "/", label: "العربيات", icon: Truck, exact: true },
  { to: "/ai", label: "بحث ذكي", icon: Sparkles },
  { to: "/due", label: "المستحق", icon: CalendarClock },
  { to: "/inventory", label: "المخزن", icon: CircleDot },
  { to: "/settings", label: "الإعدادات", icon: Settings },
];

export function MainLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-60 flex-col border-e bg-card/60 backdrop-blur">
        <div className="flex items-center gap-2 px-5 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">أبيكس</div>
            <div className="text-xs text-muted-foreground">الصيانة</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: !!exact }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground [&.active]:bg-primary/10 [&.active]:font-semibold [&.active]:text-primary"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <button
          onClick={async () => { await performLogout(); navigate({ to: "/login" }); }}
          className="m-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent"
        >
          <LogOut className="h-4 w-4" /> خروج
        </button>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
