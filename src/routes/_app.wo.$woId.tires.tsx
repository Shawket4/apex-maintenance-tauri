import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { PositionRow } from "@/shared/api/client";
import { useChassis, useTruck, useWo } from "@/shared/api/queries";
import { TruckDiagram } from "@/widgets/TruckDiagram/TruckDiagram";
import { ChassisWizard } from "@/widgets/diagram/ChassisWizard";
import { DismountForm } from "@/widgets/diagram/DismountSheet";
import { MountForm } from "@/widgets/diagram/MountSheet";
import { DiagramLayout, InspectorShell, PositionList, TireFacts } from "@/widgets/diagram/Workbench";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/wo/$woId/tires")({
  // Selection lives in the URL (see the truck tires route): back/refresh
  // restores the same wheel and its top-down pair focus.
  validateSearch: (s: Record<string, unknown>): { pos?: string } =>
    typeof s.pos === "string" && s.pos ? { pos: s.pos } : {},
  component: WoTires,
});

/** ACTION mode, scoped to this WO. Empty → mount form in the inspector;
 * occupied → facts + dismount form. The canvas is never overlaid. */
function WoTires() {
  const { t } = useTranslation();
  const { woId } = Route.useParams();
  const { pos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const wo = useWo(woId);
  const vid = wo.data?.wo.vehicle_id ?? 0;
  const truck = useTruck(vid);
  const chassis = useChassis(vid);

  if (wo.isLoading || (vid !== 0 && chassis.isLoading)) {
    return (
      <PageShell>
        <Skeleton className="h-[560px] rounded-xl" />
      </PageShell>
    );
  }
  if (!wo.data) {
    return (
      <PageShell>
        <EmptyState>{t("wo.notFound")}</EmptyState>
      </PageShell>
    );
  }

  const isOpen = wo.data.wo.status === "open";
  const defaultOdometer = wo.data.wo.odometer_at_open;
  const data = chassis.data;
  const selected = data?.positions.find((p) => p.id === pos) ?? null;

  const select = (p: PositionRow | null) =>
    void navigate({ search: p ? { pos: p.id } : {}, replace: true });

  return (
    <PageShell width="wide">
      <div className="text-xs text-muted-foreground">
        <Link
          to="/wo/$woId"
          params={{ woId }}
          className="font-medium text-muted-foreground hover:text-foreground"
        >
          {t("wo.title")} {wo.data.wo.plate}
        </Link>{" "}
        ‹ <span className="font-semibold text-foreground">{t("diagram.title")}</span>
      </div>

      {!data ? (
        <ChassisWizard vehicleId={vid} />
      ) : (
        <DiagramLayout
          canvas={
            <TruckDiagram
              axles={data.axles}
              positions={data.positions}
              selectedId={selected?.id ?? null}
              onSelect={(p) => select(isOpen ? p : null)}
            />
          }
          inspector={
            !isOpen ? (
              <>
                <EmptyState className="p-4 text-xs">{t("diagram.needWo")}</EmptyState>
                <PositionList chassis={data} selectedId={null} onSelect={() => undefined} />
              </>
            ) : selected ? (
              selected.tire_id && selected.assignment_id ? (
                <InspectorShell
                  position={selected}
                  title={t("diagram.dismount.title")}
                  subtitle={<span dir="ltr">{selected.dot_code ?? selected.brand ?? ""}</span>}
                  accent="destructive"
                  onClose={() => select(null)}
                >
                  <TireFacts position={selected} currentKm={truck.data?.odometer?.km ?? null} />
                  <div className="my-4 border-t" />
                  <DismountForm
                    key={selected.id}
                    position={selected}
                    workOrderId={woId}
                    defaultOdometer={defaultOdometer}
                    onClose={() => select(null)}
                  />
                </InspectorShell>
              ) : (
                <InspectorShell
                  position={selected}
                  title={t("diagram.mount.title")}
                  onClose={() => select(null)}
                >
                  <MountForm
                    key={selected.id}
                    position={selected}
                    vehicleId={vid}
                    workOrderId={woId}
                    defaultOdometer={defaultOdometer}
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
      )}
    </PageShell>
  );
}
