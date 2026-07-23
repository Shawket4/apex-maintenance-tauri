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
  // Selection lives in the URL (see the truck tires route): back/refresh
  // restores the same wheel and its top-down pair focus.
  validateSearch: (s: Record<string, unknown>): { pos?: string } =>
    typeof s.pos === "string" && s.pos ? { pos: s.pos } : {},
  component: WoTires,
});

/** ACTION mode, scoped to this WO: click an EMPTY position → mount (from new
 * stock or the used pool); click an OCCUPIED one → dismount with a reason.
 * Every event lands on this work order. */
function WoTires() {
  const { t } = useTranslation();
  const { woId } = Route.useParams();
  const { pos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const wo = useWo(woId);
  const vid = wo.data?.wo.vehicle_id ?? 0;
  const chassis = useChassis(vid);

  if (wo.isLoading || (vid !== 0 && chassis.isLoading)) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    );
  }
  if (!wo.data) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("wo.notFound")}
        </div>
      </div>
    );
  }

  const isOpen = wo.data.wo.status === "open";
  const defaultOdometer = wo.data.wo.odometer_at_open;
  const positions = chassis.data?.positions ?? [];
  const selected = positions.find((p) => p.id === pos) ?? null;

  const select = (p: PositionRow | null) =>
    void navigate({ search: p ? { pos: p.id } : {}, replace: true });

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
        <div className="relative h-[520px] overflow-hidden rounded-xl border bg-card">
          <TruckDiagram
            axles={chassis.data.axles}
            positions={positions}
            selectedId={selected?.id ?? null}
            onSelect={(p) => select(isOpen ? p : null)}
          />
          {!isOpen && (
            <div className="absolute inset-x-0 top-0 bg-muted/80 p-2 text-center text-xs text-muted-foreground backdrop-blur">
              {t("diagram.needWo")}
            </div>
          )}

          {isOpen && selected && !selected.tire_id && (
            <MountSheet
              key={selected.id}
              position={selected}
              vehicleId={vid}
              workOrderId={woId}
              defaultOdometer={defaultOdometer}
              onClose={() => select(null)}
            />
          )}
          {isOpen && selected?.tire_id && selected.assignment_id && (
            <DismountSheet
              key={selected.id}
              position={selected}
              workOrderId={woId}
              defaultOdometer={defaultOdometer}
              onClose={() => select(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
