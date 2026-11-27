import { useTranslation } from "react-i18next";
import { CloudOff } from "lucide-react";

import { useAuth } from "@/shared/api/auth";
import { useSyncStatus } from "@/shared/api/queries";
import { PageShell } from "@/widgets/layout/PageShell";

import { FeeFinderPanel } from "./FeeFinderPanel";

/** Who sees fees and bands (the fee service enforces the same level). */
const FEE_PERMISSION = 3;

/** Route fee lookup: company → terminal → drop-off, the route and its fee.
 * Online only — it asks the fee service live. */
export function FeesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useSyncStatus().data?.online;
  const feesWithheld = (user?.permission ?? 0) < FEE_PERMISSION;
  return (
    <PageShell title={t("fees.title")} subtitle={t("fees.subtitle")} width="wide">
      {online === false && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-status-due_soon/40 bg-status-due_soon-soft px-3 py-2 text-sm">
          <CloudOff className="mt-0.5 h-4 w-4 flex-none text-status-due_soon" />
          {t("fees.offline")}
        </p>
      )}
      {feesWithheld && <p className="mb-4 text-sm text-muted-foreground">{t("fees.distancesOnly")}</p>}
      <FeeFinderPanel feesWithheld={feesWithheld} />
    </PageShell>
  );
}
