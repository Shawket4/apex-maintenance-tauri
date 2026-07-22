import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import type { PositionRow } from "@/shared/api/client";
import { useChassis, useTruck } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { TIRE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { TruckDiagram } from "@/widgets/TruckDiagram/TruckDiagram";
import { ChassisWizard } from "@/widgets/diagram/ChassisWizard";
import { DiagramPanel } from "@/widgets/diagram/DiagramPanel";
import { OnboardCard } from "@/widgets/diagram/OnboardCard";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/trucks/$truckId/tires")({
  // The selected position lives in the URL so returning here (back from a
  // tire file, refresh, a shared link) restores the diagram exactly: same
  // truck, same wheel, same top-down pair focus.
  validateSearch: (s: Record<string, unknown>): { pos?: string } =>
    typeof s.pos === "string" && s.pos ? { pos: s.pos } : {},
  component: TruckTires,
});

/** INSPECT mode: the truck's real chassis. Occupied → detailed tire panel;
 * empty → onboarding (legacy, no WO). Mount/dismount live in the WO diagram. */
function TruckTires() {
  const { t, i18n } = useTranslation();
  const { truckId } = Route.useParams();
  const { pos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const vid = Number(truckId);
  const truck = useTruck(vid);
  const chassis = useChassis(vid);

  if (chassis.isLoading) return <Skeleton className="h-[460px] rounded-2xl" />;
  if (!chassis.data) return <ChassisWizard vehicleId={vid} />;

  const { axles, positions } = chassis.data;
  const emptyPositions = positions.filter((p) => !p.tire_id);
  const selected = positions.find((p) => p.id === pos) ?? null;

  const select = (p: PositionRow | null) =>
    void navigate({ search: p ? { pos: p.id } : {}, replace: true });

  const currentKm = truck.data?.odometer?.km ?? null;
  const runThisMount =
    selected?.tire_id && selected.mounted_odometer != null && currentKm != null && !selected.is_spare
      ? Math.max(0, currentKm - selected.mounted_odometer)
      : null;

  return (
    <div className="relative h-[520px] overflow-hidden rounded-2xl border bg-card">
      <TruckDiagram
        axles={axles}
        positions={positions}
        selectedId={selected?.id ?? null}
        onSelect={select}
      />

      {selected?.tire_id && (
        <DiagramPanel
          code={selected.position_code}
          title={selected.dot_code ?? selected.brand ?? ""}
          subtitle={
            [selected.brand, selected.model, selected.size].filter(Boolean).join(" ") || undefined
          }
          onClose={() => select(null)}
        >
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {selected.tire_status && (
              <span className={cn("rounded-full px-2 py-0.5 text-xs", TIRE_BADGE[selected.tire_status])}>
                {t(`tires.status.${selected.tire_status}`)}
              </span>
            )}
            {selected.is_spare && <Badge variant="secondary">{t("diagram.spare")}</Badge>}
            {selected.origin && (
              <Badge variant="outline">{t(`tires.origin.${selected.origin}`)}</Badge>
            )}
            {selected.pending && <Badge variant="outline">{t("diagram.queued")}</Badge>}
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <Fact label={t("diagram.inspect.lifetimeKm")}>
              <span className="tabular">
                {fmtNumber(selected.total_km ?? 0, i18n.language)} {t("common.km")}
              </span>
            </Fact>
            {runThisMount != null && (
              <Fact label={t("diagram.inspect.currentRun")}>
                <span className="tabular">
                  {fmtNumber(runThisMount, i18n.language)} {t("common.km")}
                </span>
              </Fact>
            )}
            {selected.mounted_at && (
              <Fact label={t("diagram.inspect.mountedAt")}>
                <span className="tabular">
                  {fmtCairo(selected.mounted_at, "YYYY/MM/DD", i18n.language)}
                </span>
              </Fact>
            )}
            {selected.mounted_odometer != null && (
              <Fact label={t("diagram.inspect.mountedOdo")}>
                <span className="tabular">
                  {fmtNumber(selected.mounted_odometer, i18n.language)} {t("common.km")}
                </span>
              </Fact>
            )}
            {selected.mount_reason && (
              <Fact label={t("diagram.inspect.mountReason")}>
                {t(`tires.mountReason.${selected.mount_reason}`)}
              </Fact>
            )}
            {(selected.retread_count ?? 0) > 0 && (
              <Fact label={t("tires.retreads")}>
                <span className="tabular">{fmtNumber(selected.retread_count, i18n.language)}</span>
              </Fact>
            )}
          </dl>

          <Link
            to="/tires/$tireId"
            params={{ tireId: selected.tire_id }}
            className="mt-4 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {t("diagram.inspect.fullFile")}
            <ArrowLeft className="h-3.5 w-3.5 ltr:rotate-180" />
          </Link>
        </DiagramPanel>
      )}

      {selected && !selected.tire_id && (
        <OnboardCard
          key={selected.id}
          position={selected}
          vehicleId={vid}
          emptyPositions={emptyPositions}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
