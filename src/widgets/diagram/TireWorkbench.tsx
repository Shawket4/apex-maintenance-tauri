import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2, Lock, Undo2 } from "lucide-react";

import {
  commands,
  unwrap,
  type ChassisPayload,
  type PositionRow,
  type TireOpRow,
  type WoDetail,
} from "@/shared/api/client";
import { useChassis, useDomainMutation, useTruck, useWos } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { WheelDiagram, positionLabel } from "apex-tire-diagram";

import { ChassisRebuild, ChassisWizard } from "./ChassisWizard";
import { WheelInspector } from "./WheelInspector";
import { DiagramLayout } from "./Workbench";
import { commonSize } from "./pick";
import { useSelectionGuard } from "./useSelectionGuard";

/** The chosen wheel lives in the route's URL (`?pos=`), so back / refresh
 * restores it; the route hands it down with the way to change it. */
interface Selection {
  pos: string | undefined;
  onSelectPos: (positionId: string | null) => void;
}

/** The truck's tire tab once it has a wheel layout. Looking is always
 * possible; registering a tire that is already on the truck is possible
 * here; fitting and dismounting are work-order jobs, and the inspector says
 * how to get to one. */
export function TruckWheels({ vehicleId, data, pos, onSelectPos }: { vehicleId: number; data: ChassisPayload } & Selection) {
  const { t, i18n } = useTranslation();
  const truck = useTruck(vehicleId);
  const openWos = useWos("open", vehicleId);

  const selected = data.positions.find((p) => p.id === pos) ?? null;
  const select = (p: PositionRow | null) => onSelectPos(p?.id ?? null);
  const guard = useSelectionGuard(selected?.id ?? null, select);

  const mountedCount = data.positions.filter((p) => p.tire_id).length;
  const preferredSize = useMemo(() => commonSize(data.positions.map((p) => p.size)), [data.positions]);
  const noRecent = useMemo<string[]>(() => [], []);

  return (
    <div className="space-y-5">
      {mountedCount === 0 && (
        <p className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm leading-relaxed">
          {t("diagram.firstTime")}
        </p>
      )}
      <DiagramLayout
        diagram={
          <WheelDiagram
            axles={data.axles}
            positions={data.positions}
            lang={i18n.language}
            selectedId={selected?.id ?? null}
            onSelect={guard.request}
          />
        }
        inspectorTitle={
          selected ? positionLabel(selected, data.axles, i18n.language) : t("diagram.title")
        }
        onCloseInspector={() => guard.request(null)}
        inspector={
          selected ? (
            <WheelInspector
              key={selected.id}
              position={selected}
              axles={data.axles}
              positions={data.positions}
              vehicleId={vehicleId}
              truckOdometer={truck.data?.odometer?.km ?? null}
              mode={{ kind: "truck", openWoId: openWos.data?.[0]?.id ?? null, checking: openWos.isPending }}
              preferredSize={preferredSize}
              previousTireId={null}
              recentTireIds={noRecent}
              onClose={() => guard.request(null)}
              onSaved={() => guard.go(null)}
              onDirtyChange={guard.setDirty}
            />
          ) : null
        }
      />
      {guard.dialog}
      <ChassisRebuild vehicleId={vehicleId} mountedCount={mountedCount} />
    </div>
  );
}

/** Tire work inside ONE work order: fit onto an empty wheel, take a tire
 * off, undo either. A closed work order can be looked at and reopened. */
export function WoWheels({ detail, pos, onSelectPos }: { detail: WoDetail } & Selection) {
  const { t } = useTranslation();
  const woId = detail.wo.id;
  const vid = detail.wo.vehicle_id;
  const isOpen = detail.wo.status === "open";
  const chassis = useChassis(vid);
  const reopen = useDomainMutation(() => unwrap(commands.woReopen(woId)), {
    onSuccess: () => notifySuccess(t("diagram.needWo.reopened")),
    onError: notifyError,
  });

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/wo/$woId"
          params={{ woId }}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowRight aria-hidden className="h-4 w-4 ltr:-scale-x-100" />
          {t("diagram.backToWo")}
        </Link>
        <h1 className="text-xl font-bold leading-relaxed">
          {t("diagram.woTitle")} <bdi className="[word-spacing:0.12em]">{detail.wo.plate}</bdi>
        </h1>
      </div>

      {!isOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-due_soon/40 bg-status-due_soon-soft px-4 py-3">
          <p className="flex items-start gap-2 text-sm leading-relaxed">
            <Lock aria-hidden className="mt-0.5 h-4 w-4 flex-none text-status-due_soon" />
            {t("diagram.needWo.closed")}
          </p>
          <Button disabled={reopen.isPending} onClick={() => reopen.mutate()}>
            {reopen.isPending && <Loader2 className="animate-spin" />}
            {t("diagram.needWo.reopen")}
          </Button>
        </div>
      )}

      <QueryState query={chassis} skeleton={<Skeleton className="h-96 rounded-xl" />}>
        {(data) =>
          data ? (
            <WoWorkbench detail={detail} data={data} pos={pos} onSelectPos={onSelectPos} />
          ) : (
            <ChassisWizard vehicleId={vid} />
          )
        }
      </QueryState>
    </div>
  );
}

function WoWorkbench({
  detail,
  data,
  pos,
  onSelectPos,
}: { detail: WoDetail; data: ChassisPayload } & Selection) {
  const { t, i18n } = useTranslation();
  const woId = detail.wo.id;
  const isOpen = detail.wo.status === "open";

  const selected = data.positions.find((p) => p.id === pos) ?? null;
  const select = (p: PositionRow | null) => onSelectPos(p?.id ?? null);
  const guard = useSelectionGuard(selected?.id ?? null, select);

  // Tires taken off in this work order, newest first.
  const dismounts = useMemo(
    () =>
      detail.tire_ops
        .filter((o) => o.dismounted_at != null)
        .sort((a, b) => (b.dismounted_at ?? "").localeCompare(a.dismounted_at ?? "")),
    [detail.tire_ops],
  );
  const recentTireIds = useMemo(() => dismounts.map((o) => o.tire_id), [dismounts]);

  // The size this wheel most likely takes: its axle's other tires, else the truck's.
  const preferredSize = useMemo(() => {
    const onAxle = selected?.axle_id
      ? commonSize(data.positions.filter((p) => p.axle_id === selected.axle_id).map((p) => p.size))
      : null;
    return onAxle ?? commonSize(data.positions.map((p) => p.size));
  }, [data.positions, selected?.axle_id]);
  const previousTireId = selected
    ? (dismounts.find((o) => o.position_code === selected.position_code)?.tire_id ?? null)
    : null;

  const labelOf = (code: string | null) => {
    const p = data.positions.find((x) => x.position_code === code);
    return p ? positionLabel(p, data.axles, i18n.language) : (code ?? "");
  };

  return (
    <>
      <DiagramLayout
        diagram={
          <WheelDiagram
            axles={data.axles}
            positions={data.positions}
            lang={i18n.language}
            selectedId={selected?.id ?? null}
            onSelect={guard.request}
          />
        }
        inspectorTitle={selected ? positionLabel(selected, data.axles, i18n.language) : t("diagram.title")}
        onCloseInspector={() => guard.request(null)}
        inspector={
          selected ? (
            <WheelInspector
              key={selected.id}
              position={selected}
              axles={data.axles}
              positions={data.positions}
              vehicleId={detail.wo.vehicle_id}
              truckOdometer={detail.odometer?.km ?? detail.wo.odometer_at_open ?? null}
              mode={{ kind: "wo", woId, open: isOpen }}
              preferredSize={preferredSize}
              previousTireId={previousTireId}
              recentTireIds={recentTireIds}
              onClose={() => guard.request(null)}
              onSaved={() => guard.go(null)}
              onDirtyChange={guard.setDirty}
            />
          ) : null
        }
      />
      {guard.dialog}

      {dismounts.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-base font-bold">{t("diagram.taken.title")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("diagram.taken.hint")}</p>
          <ul className="mt-3 divide-y">
            {dismounts.map((op) => (
              <DismountedRow key={op.assignment_id} op={op} where={labelOf(op.position_code)} canUndo={isOpen} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** One tire taken off in this work order, with the way to put it back if
 * that was a mistake (refused, with a reason, once the tire has been used
 * somewhere else). */
function DismountedRow({ op, where, canUndo }: { op: TireOpRow; where: string; canUndo: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const undo = useDomainMutation(() => unwrap(commands.dismountUndo(op.assignment_id)), {
    onSuccess: () => {
      setOpen(false);
      notifySuccess(t("diagram.taken.undone"));
    },
    onError: (e) => {
      setOpen(false);
      notifyError(e);
    },
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 text-sm">
        <div className="font-semibold">
          <bdi dir="ltr">{op.brand ?? t("diagram.tire.unknownBrand")}</bdi>
          {" · "}
          {op.dot_code ? <bdi dir="ltr">{op.dot_code}</bdi> : t("diagram.tire.noDot")}
        </div>
        <div className="text-muted-foreground">
          {t("diagram.taken.from", { where })}
          {op.dismount_reason ? ` · ${t(`diagram.reason.${op.dismount_reason}`)}` : ""}
          {op.pending ? ` · ${t("diagram.legend.pending")}` : ""}
        </div>
      </div>
      {canUndo && (
        <>
          <Button variant="outline" disabled={undo.isPending} onClick={() => setOpen(true)}>
            {undo.isPending ? <Loader2 className="animate-spin" /> : <Undo2 aria-hidden />}
            {t("diagram.taken.undo")}
          </Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title={t("diagram.taken.undoTitle")}
            description={t("diagram.taken.undoBody", { where })}
            confirmLabel={t("diagram.taken.undo")}
            pending={undo.isPending}
            onConfirm={() => undo.mutate()}
          />
        </>
      )}
    </li>
  );
}
