import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CloudDownload } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";

/** Shown when the server declares this build too old (min_client_version from
 * /health). Checked once per session, unauthenticated — an expired session
 * must still learn it needs an update.
 *
 * The app has no updater and the server sends no download address, so the one
 * honest instruction is "get the new version from the office"; the banner
 * says which version this is so the office knows what to send. It stays
 * pinned to the top of the page while the user scrolls. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["server-version"],
    queryFn: () => unwrap(commands.serverVersionCheck()),
    staleTime: Infinity,
    retry: false,
  });
  const app = useQuery({
    queryKey: ["app-version"],
    queryFn: () => commands.getAppVersion(),
    staleTime: Infinity,
    enabled: data?.update_required === true,
  });
  if (!data?.update_required) return null;
  return (
    // The tint is translucent: the solid layer under it keeps the page from
    // showing through while it is pinned.
    <div role="alert" className="sticky top-0 z-30 bg-background print:hidden">
      <div className="flex items-start gap-3 border-b border-status-overdue/30 bg-status-overdue-soft px-4 py-3 text-status-overdue sm:px-5">
        <CloudDownload className="mt-0.5 h-5 w-5 flex-none" />
        <div className="min-w-0 text-sm leading-6">
          <div className="font-bold">{t("settings.update.title")}</div>
          <div>{t("settings.update.whatToDo")}</div>
          <div className="mt-0.5 text-xs">
            {app.data && (
              <>
                {t("settings.update.yours")} <bdi dir="ltr">{app.data.version}</bdi>
                {" · "}
              </>
            )}
            {t("settings.update.needed")} <bdi dir="ltr">{data.min_client_version}</bdi>
          </div>
        </div>
      </div>
    </div>
  );
}
