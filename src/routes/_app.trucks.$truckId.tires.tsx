import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import type { PositionRow } from "@/shared/api/client";
import { useChassis, useTruck } from "@/shared/api/queries";
import { TruckDiagram } from "@/widgets/TruckDiagram/TruckDiagram";
import { ChassisWizard } from "@/widgets/diagram/ChassisWizard";
import { OnboardForm } from "@/widgets/diagram/OnboardCard";
import { DiagramLayout, InspectorShell, PositionList, TireFacts } from "@/widgets/diagram/Workbench";
import { EmptyState } from "@/widgets/layout/PageShell";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/trucks/$truckId/tires")({
  // The selected position lives in the URL so returning here (back from a
  // tire file, refresh, a shared link) restores the diagram exactly: same
  // truck, same wheel, same top-down pair focus.
  validateSearch: (s: Record<string, unknown>): { pos?: string } =>
    typeof s.pos === "string" && s.pos ? { pos: s.pos } : {},
  component: TruckTires,
});

/** INSPECT mode. The canvas owns its column; everything informational lives
 * in the inspector beside it — the top-down pair view is never covered.
 * Occupied → facts; empty → onboarding; nothing selected → position list. */
function TruckTires() {
  const { t } = useTranslation();
  const { truckId } = Route.useParams();
  const { pos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const vid = Number(truckId);
  const truck = useTruck(vid);
  const chassis = useChassis(vid);

  if (chassis.isLoading) return <Skeleton className="h-[560px] rounded-xl" />;
  if (!chassis.data) return <ChassisWizard vehicleId={vid} />;

  const data = chassis.data;
  const emptyPositions = data.positions.filter((p) => !p.tire_id);
  const selected = data.positions.find((p) => p.id === pos) ?? null;

  const select = (p: PositionRow | null) =>
    void navigate({ search: p ? { pos: p.id } : {}, replace: true });

  return (
    <DiagramLayout
      canvas={
        <TruckDiagram
          axles={data.axles}
          positions={data.positions}
          selectedId={selected?.id ?? null}
          onSelect={select}
        />
      }
      inspector={
        selected ? (
          selected.tire_id ? (
            <InspectorShell
              position={selected}
              title={<span dir="ltr">{selected.dot_code ?? selected.brand ?? ""}</span>}
              subtitle={
                [selected.brand, selected.model, selected.size].filter(Boolean).join(" ") ||
                undefined
              }
              onClose={() => select(null)}
            >
              <TireFacts position={selected} currentKm={truck.data?.odometer?.km ?? null} />
              <Link
                to="/tires/$tireId"
                params={{ tireId: selected.tire_id }}
                className="mt-4 flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                {t("diagram.inspect.fullFile")}
                <ArrowLeft className="h-3.5 w-3.5 ltr:rotate-180" />
              </Link>
            </InspectorShell>
          ) : (
            <InspectorShell
              position={selected}
              title={t("diagram.onboard.title")}
              onClose={() => select(null)}
            >
              <OnboardForm
                key={selected.id}
                position={selected}
                vehicleId={vid}
                emptyPositions={emptyPositions}
                onClose={() => select(null)}
              />
            </InspectorShell>
          )
        ) : (
          <>
            <EmptyState className="p-4 text-xs">{t("diagram.selectHint")}</EmptyState>
            <PositionList chassis={data} selectedId={null} onSelect={select} />
          </>
        )
      }
    />
  );
}
