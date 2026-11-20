import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, Plus, RefreshCw } from "lucide-react";

import type { OdoTruth, WoListRow } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { OpenWoDialog } from "@/widgets/wo/OpenWoDialog";

/** The one "work order" action for a truck. It never offers "open a work
 * order" before it knows whether one is already open: while the list is
 * loading the button is disabled; when one is open, going to it is the main
 * action and opening another is a deliberate second choice. */
export function TruckWoAction({
  vehicleId,
  odometer,
  openWos,
  loading,
  failed,
  onRetry,
  allowAnother = false,
  size = "default",
}: {
  vehicleId: number;
  odometer: OdoTruth | null | undefined;
  /** This truck's open work orders (newest first). */
  openWos: WoListRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  allowAnother?: boolean;
  size?: "default" | "sm";
}) {
  const { t } = useTranslation();

  if (failed) {
    return (
      <Button variant="outline" size={size} onClick={onRetry}>
        <RefreshCw />
        {t("truck.woCheckFailed")}
      </Button>
    );
  }
  if (loading) {
    return (
      <Button variant="outline" size={size} disabled aria-busy="true">
        <Loader2 className="animate-spin" />
        {t("truck.woChecking")}
      </Button>
    );
  }

  const open = openWos[0];
  if (!open) {
    return (
      <OpenWoDialog
        vehicleId={vehicleId}
        odometer={odometer}
        trigger={
          <Button size={size}>
            <Plus />
            {t("truck.openWo")}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Button asChild size={size}>
        <Link to="/wo/$woId" params={{ woId: open.id }}>
          {t("truck.goToOpenWo")}
          <ArrowLeft className="ltr:-scale-x-100" />
        </Link>
      </Button>
      {allowAnother && (
        <OpenWoDialog
          vehicleId={vehicleId}
          odometer={odometer}
          trigger={
            <Button variant="outline" size={size}>
              <Plus />
              {t("truck.openAnotherWo")}
            </Button>
          }
        />
      )}
    </>
  );
}
