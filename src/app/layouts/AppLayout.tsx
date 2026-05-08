import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Languages, Wifi, WifiOff } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { useAuth } from "@/shared/api/auth";
import { useNetworkStatus } from "@/shared/hooks/useNetworkStatus";
import { AppSidebar } from "@/widgets/AppSidebar/AppSidebar";

export function AppLayout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const online = useNetworkStatus();

  const toggleLang = () => {
    const next = i18n.language?.startsWith("ar") ? "en" : "ar";
    i18n.changeLanguage(next);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center justify-between px-4 sticky top-0 bg-background/95 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">
            A
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">{t("app.title")}</span>
            <span className="text-xs text-muted-foreground">{t("app.subtitle")}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {online ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                <span>{t("status.online")}</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                <span>{t("status.offline")}</span>
              </>
            )}
          </span>

          {user && (
            <span className="hidden md:inline text-sm text-muted-foreground">
              {user.name || user.email}
            </span>
          )}

          <Button variant="ghost" size="sm" onClick={toggleLang} title={t("actions.toggle_language")}>
            <Languages className="h-4 w-4" />
            <span className="ms-1.5 hidden sm:inline">
              {i18n.language?.startsWith("ar") ? "EN" : "AR"}
            </span>
          </Button>

          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut className="h-4 w-4" />
            <span className="ms-1.5 hidden sm:inline">{t("actions.logout")}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <AppSidebar />
        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
