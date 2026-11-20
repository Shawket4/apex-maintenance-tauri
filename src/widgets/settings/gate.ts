import { useTranslation } from "react-i18next";

import { useAuth } from "@/shared/api/auth";
import { useSyncStatus } from "@/shared/api/queries";

/** Classes and plans are fleet rules: the server only takes them from a
 * supervisor (permission 3 or more), and only while connected. */
export const CONFIGURE_PERMISSION = 3;

/** Who may change fleet rules right now, and why not when they may not. */
export function useConfigureGate() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const sync = useSyncStatus();
  const allowed = (user?.permission ?? 0) >= CONFIGURE_PERMISSION;
  const online = sync.data?.online ?? false;
  const reason = !allowed ? t("settings.gate.noPermission") : !online ? t("settings.gate.offline") : null;
  return { allowed, online, canEdit: allowed && online, reason };
}
