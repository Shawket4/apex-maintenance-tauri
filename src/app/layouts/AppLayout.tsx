import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Wifi, WifiOff } from "lucide-react";

import { useNetworkStatus } from "@/shared/hooks/useNetworkStatus";
import { AppSidebar } from "@/widgets/AppSidebar/AppSidebar";

export function AppLayout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const online = useNetworkStatus();

  return (
    <div 
      className="h-screen flex bg-background overflow-hidden print:h-auto print:overflow-visible print:block"
      dir={i18n.dir() === "rtl" ? "rtl" : "ltr"}
    >
      <AppSidebar />

      <div className="flex flex-1 min-w-0 flex-col print:block">
        <header className="h-12 border-b border-border flex items-center justify-end px-4 sticky top-0 bg-background/95 backdrop-blur z-10 print:hidden">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
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
        </header>

        <main className="flex-1 overflow-auto p-6 print:overflow-visible print:p-8">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
