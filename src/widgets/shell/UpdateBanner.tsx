import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CloudDownload } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";

/** Shown when the server declares this build too old for its sync contract
 * (min_client_version from /health). Checked once per session, unauthenticated
 * — an expired session must still learn it needs an update. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["server-version"],
    queryFn: () => unwrap(commands.serverVersionCheck()),
    staleTime: Infinity,
    retry: false,
  });
  if (!data?.update_required) return null;
  return (
    <div className="flex items-center gap-2.5 border-b bg-status-overdue-soft px-5 py-2.5 text-sm font-semibold text-status-overdue">
      <CloudDownload className="h-4 w-4 flex-none" />
      {t("app.updateRequired", { version: data.min_client_version })}
    </div>
  );
}
