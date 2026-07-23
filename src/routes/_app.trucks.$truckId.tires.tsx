import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import type { PositionRow } from "@/shared/api/client";
import { useChassis, useTruck } from "@/shared/api/queries";
import { TruckDiagram } from "@/widgets/TruckDiagram/TruckDiagram";
import { ChassisWizard } from "@/widgets/diagram/ChassisWizard";
import { OnboardForm } from "@/widgets/diagram/OnboardCard";
import { DiagramLayout, InspectorShell, TireFacts } from "@/widgets/diagram/Workbench";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/trucks/$truckId/tires")({
  // The selected position lives in the URL so returning here (back from a
  // tire file, refresh, a shared link) restores the diagram exactly: same
  // truck, same wheel, same top-down pair focus.
  validateSearch: (s: Record<string, unknown>): { pos?: string } =>
    typeof s.pos === "string" && s.pos ? { pos: s.pos } : {},
  component: TruckTires,
});

/** INSPECT mode. The canvas owns the full row; pressing a wheel opens the
 * inspector card beside it — the top-down pair view is never covered.
 * Occupied → facts; empty → onboarding. */
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
  // Bulk "same for all" fills ROAD positions only — fabricating spare tires
  // silently was the bug.
  const emptyPositions = data.positions.filter((p) => !p.tire_id && !p.is_spare);
  const selected = data.positions.find((p) => p.id === pos) ?? null;

  const select = (p: PositionRow | null) =>
    void navigate({ search: p ? { pos: p.id } : {}, replace: true });

  const mountedCount = data.positions.filter((p) => p.tire_id).length;

  return (
    <>
    <DiagramLayout
      hint={t("diagram.selectHint")}
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
        ) : null
      }
    />
    {/* Escape hatch: a wrong axle count at onboarding used to be permanent.
      * Guarded — refused while anything is mounted. */}
    {mountedCount === 0 && (
      <div className="mt-2 text-end">
        <RebuildChassisButton vehicleId={vid} />
      </div>
    )}
    </>
  );
}

function RebuildChassisButton({ vehicleId }: { vehicleId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const del = useDomainMutation(() => unwrap(commands.chassisDelete(vehicleId)), {
    onSuccess: () => setOpen(false),
    onError: notifyError,
  });
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
      >
        {t("chassis.rebuild")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("chassis.rebuildTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("chassis.rebuildBody")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate()}>
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
