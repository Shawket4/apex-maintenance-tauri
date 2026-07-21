import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { PositionRow } from "@/shared/api/client";
import { useChassis, useTruck } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { TIRE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { TruckDiagram } from "@/widgets/TruckDiagram/TruckDiagram";
import { ChassisWizard } from "@/widgets/diagram/ChassisWizard";
import { DiagramPanel } from "@/widgets/diagram/DiagramPanel";
import { OnboardCard } from "@/widgets/diagram/OnboardCard";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/trucks/$truckId/tires")({
  component: TruckTires,
});

/** INSPECT mode: the truck's real chassis. Occupied → tire card; empty →
 * onboarding (legacy, no WO). Mount/dismount live in the WO-scoped diagram. */
function TruckTires() {
  const { t, i18n } = useTranslation();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  const truck = useTruck(vid);
  const chassis = useChassis(vid);
  const [selected, setSelected] = useState<PositionRow | null>(null);
  const [onboarding, setOnboarding] = useState<PositionRow | null>(null);

  if (chassis.isLoading) return <Skeleton className="h-[460px] rounded-2xl" />;

  if (!chassis.data) {
    return <ChassisWizard vehicleId={vid} />;
  }

  const { axles, positions } = chassis.data;
  const emptyPositions = positions.filter((p) => !p.tire_id);

  return (
    <div>
      <div className="relative h-[500px] overflow-hidden rounded-2xl border bg-card">
        <TruckDiagram
          axles={axles}
          positions={positions}
          selectedId={selected?.id ?? null}
          onSelect={(p) => {
            setSelected(p);
            setOnboarding(p && !p.tire_id ? p : null);
          }}
        />

        {selected?.tire_id && (
          <DiagramPanel
            code={selected.position_code}
            title={selected.dot_code ?? selected.brand ?? ""}
            subtitle={selected.is_spare ? t("diagram.spare") : undefined}
            onClose={() => setSelected(null)}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm tabular">
                {fmtNumber(selected.total_km ?? 0, i18n.language)} {t("common.km")}
              </span>
              <span className="flex items-center gap-1.5">
                {selected.pending && (
                  <Badge variant="outline" className="text-[10px]">
                    {t("diagram.queued")}
                  </Badge>
                )}
                {selected.tire_status && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      TIRE_BADGE[selected.tire_status],
                    )}
                  >
                    {t(`tires.status.${selected.tire_status}`)}
                  </span>
                )}
              </span>
            </div>
            <Link
              to="/tires/$tireId"
              params={{ tireId: selected.tire_id }}
              className="mt-3 block text-sm font-medium text-primary hover:underline"
            >
              {t("tires.history")}
            </Link>
          </DiagramPanel>
        )}

        {onboarding && (
          <OnboardCard
            key={onboarding.id}
            position={onboarding}
            vehicleId={vid}
            emptyPositions={emptyPositions}
            onClose={() => {
              setOnboarding(null);
              setSelected(null);
            }}
          />
        )}
      </div>
      {truck.data && !truck.data.has_chassis && null}
    </div>
  );
}
