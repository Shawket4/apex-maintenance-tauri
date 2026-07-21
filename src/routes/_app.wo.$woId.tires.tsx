import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import type { PositionRow } from "@/shared/api/client";
import { useChassis, useWo } from "@/shared/api/queries";
import { TruckDiagram } from "@/widgets/TruckDiagram/TruckDiagram";
import { ChassisWizard } from "@/widgets/diagram/ChassisWizard";
import { DismountSheet } from "@/widgets/diagram/DismountSheet";
import { MountSheet } from "@/widgets/diagram/MountSheet";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/wo/$woId/tires")({
  component: WoTires,
});

/** ACTION mode, scoped to this WO: click an EMPTY position → mount (from new
 * stock or the used pool); click an OCCUPIED one → dismount with a reason.
 * Every event lands on this work order. */
function WoTires() {
  const { t } = useTranslation();
  const { woId } = Route.useParams();
  const wo = useWo(woId);
  const vid = wo.data?.wo.vehicle_id ?? 0;
  const chassis = useChassis(vid);
  const [selected, setSelected] = useState<PositionRow | null>(null);
  const [action, setAction] = useState<"mount" | "dismount" | null>(null);

  if (wo.isLoading || (vid !== 0 && chassis.isLoading)) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Skeleton className="h-[500px] rounded-2xl" />
      </div>
    );
  }
  if (!wo.data) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("wo.notFound")}
        </div>
      </div>
    );
  }

  const isOpen = wo.data.wo.status === "open";
  const defaultOdometer = wo.data.wo.odometer_at_open;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <Link
        to="/wo/$woId"
        params={{ woId }}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("wo.title")} · {wo.data.wo.plate}
      </Link>

      {!chassis.data ? (
        <ChassisWizard vehicleId={vid} />
      ) : (
        <div className="relative h-[520px] overflow-hidden rounded-2xl border bg-card">
          <TruckDiagram
            axles={chassis.data.axles}
            positions={chassis.data.positions}
            selectedId={selected?.id ?? null}
            onSelect={(p) => {
              setSelected(p);
              if (!p || !isOpen) return;
              setAction(p.tire_id ? "dismount" : "mount");
            }}
          />
          {!isOpen && (
            <div className="absolute inset-x-0 top-0 bg-muted/80 p-2 text-center text-xs text-muted-foreground backdrop-blur">
              {t("diagram.needWo")}
            </div>
          )}
        </div>
      )}

      {action === "mount" && selected && (
        <MountSheet
          position={selected}
          vehicleId={vid}
          workOrderId={woId}
          defaultOdometer={defaultOdometer}
          onClose={() => {
            setAction(null);
            setSelected(null);
          }}
        />
      )}
      {action === "dismount" && selected?.assignment_id && (
        <DismountSheet
          position={selected}
          defaultOdometer={defaultOdometer}
          onClose={() => {
            setAction(null);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
