/**
 * The tire section: 3D diagram + position-first actions.
 *
 * No chassis yet → a small config form generates layout/axles/positions
 * locally (identical codes to maint-rust's chassis_builder) and queues them.
 * With a chassis → click a position: occupied opens dismount, empty opens
 * mount (pick from in-stock tires).
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  useChassis,
  useChassisCreate,
  useTireDismount,
  useTireMount,
  useTires,
  type ChassisPosition,
  type MountReason,
  type TireStatus,
} from "@/shared/api/tires";
import { appErrorMessage } from "@/shared/api/tauri";
import { TruckDiagram, POSITION_COLORS } from "@/widgets/TruckDiagram/TruckDiagram";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { fmtKm } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";

const MOUNT_REASONS: MountReason[] = [
  "new_install",
  "rotation",
  "replacement",
  "puncture",
  "wear",
  "damage",
  "retread_return",
];

const DISMOUNT_TARGETS: Exclude<TireStatus, "mounted">[] = [
  "in_stock",
  "in_repair",
  "retreading",
  "scrapped",
];

export function TiresSection({
  vehicleId,
  currentOdometer,
}: {
  vehicleId: number;
  currentOdometer: number | null;
}) {
  const { t } = useTranslation();
  const { data: chassis, isLoading } = useChassis(vehicleId);
  const chassisCreate = useChassisCreate(vehicleId);
  const mount = useTireMount(vehicleId);
  const dismount = useTireDismount(vehicleId);
  const { data: stockTires } = useTires("in_stock");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: ChassisPosition | null = useMemo(
    () => chassis?.positions.find((p) => p.id === selectedId) ?? null,
    [chassis, selectedId],
  );

  // chassis setup form
  const [driveAxles, setDriveAxles] = useState("2");
  const [trailerAxles, setTrailerAxles] = useState("4");
  const [spares, setSpares] = useState("2");

  // mount dialog
  const [mountOpen, setMountOpen] = useState(false);
  const [mountTireId, setMountTireId] = useState("");
  const [mountReason, setMountReason] = useState<MountReason>("new_install");
  const [mountOdo, setMountOdo] = useState("");

  // dismount dialog
  const [dismountOpen, setDismountOpen] = useState(false);
  const [dismountReason, setDismountReason] = useState<MountReason>("wear");
  const [dismountTo, setDismountTo] = useState<Exclude<TireStatus, "mounted">>("in_stock");
  const [dismountOdo, setDismountOdo] = useState("");

  const onSelect = (p: ChassisPosition | null) => {
    setSelectedId(p?.id ?? null);
  };

  const openAction = () => {
    if (!selected) return;
    if (selected.tire_id) {
      setDismountOdo(currentOdometer != null ? String(currentOdometer) : "");
      setDismountOpen(true);
    } else {
      setMountOdo(currentOdometer != null ? String(currentOdometer) : "");
      setMountTireId(stockTires?.[0]?.id ?? "");
      setMountOpen(true);
    }
  };

  const doCreateChassis = async () => {
    try {
      await chassisCreate.mutateAsync({
        drive_axles: Number(driveAxles),
        trailer_axles: Number(trailerAxles),
        spares: Number(spares),
      });
      toast.success(t("tires.chassisCreated"));
    } catch (e) {
      toast.error(appErrorMessage(e));
    }
  };

  const doMount = async () => {
    if (!selected || !mountTireId) return;
    try {
      await mount.mutateAsync({
        tireId: mountTireId,
        positionId: selected.id,
        odometer: mountOdo ? Number(mountOdo) : null,
        reason: mountReason,
      });
      toast.success(t("tires.mounted"));
      setMountOpen(false);
    } catch (e) {
      toast.error(appErrorMessage(e));
    }
  };

  const doDismount = async () => {
    if (!selected?.assignment_id) return;
    try {
      await dismount.mutateAsync({
        assignmentId: selected.assignment_id,
        odometer: dismountOdo ? Number(dismountOdo) : null,
        reason: dismountReason,
        toStatus: dismountTo,
      });
      toast.success(t("tires.dismounted"));
      setDismountOpen(false);
      setSelectedId(null);
    } catch (e) {
      toast.error(appErrorMessage(e));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">{t("common.loading")}</CardContent>
      </Card>
    );
  }

  // ── no chassis yet: the setup form ─────────────────────────────────────────
  if (!chassis?.layout) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("tires.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("tires.noChassis")}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cx-drive">{t("tires.driveAxles")}</Label>
              <Input id="cx-drive" className="w-24" inputMode="numeric" value={driveAxles} onChange={(e) => setDriveAxles(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cx-trailer">{t("tires.trailerAxles")}</Label>
              <Input id="cx-trailer" className="w-24" inputMode="numeric" value={trailerAxles} onChange={(e) => setTrailerAxles(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cx-spares">{t("tires.spares")}</Label>
              <Input id="cx-spares" className="w-24" inputMode="numeric" value={spares} onChange={(e) => setSpares(e.target.value)} />
            </div>
            <Button onClick={doCreateChassis} disabled={chassisCreate.isPending}>
              {t("tires.createChassis")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── the diagram ─────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between space-y-0 pb-2 gap-2">
        <CardTitle className="text-base">{t("tires.title")}</CardTitle>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {(
            [
              ["occupied", t("tires.legend.occupied")],
              ["spare", t("tires.legend.spare")],
              ["empty", t("tires.legend.empty")],
            ] as const
          ).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: POSITION_COLORS[key] }} />
              {label}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-96 rounded-lg border border-border bg-gradient-to-b from-background to-muted/40">
          <TruckDiagram
            axles={chassis.axles}
            positions={chassis.positions}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>

        {selected && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-3">
            <span className="text-lg font-bold tabular-nums">{selected.position_code}</span>
            {selected.tire_id ? (
              <>
                <span className="text-sm">{selected.brand}</span>
                <span className="text-xs text-muted-foreground font-mono">{selected.dot_code}</span>
                {selected.mounted_at && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("tires.mountedSince")}: {fmtCairo(selected.mounted_at, "YYYY/MM/DD")}
                    {selected.mounted_odometer != null && <> · {fmtKm(selected.mounted_odometer)}</>}
                  </span>
                )}
                <span className="ms-auto">
                  <Button size="sm" variant="outline" onClick={openAction}>
                    {t("tires.dismount")}
                  </Button>
                </span>
              </>
            ) : (
              <>
                <span className="text-sm text-muted-foreground">{t("tires.emptyPosition")}</span>
                <span className="ms-auto">
                  <Button size="sm" onClick={openAction} disabled={(stockTires ?? []).length === 0}>
                    {t("tires.mount")}
                  </Button>
                </span>
              </>
            )}
          </div>
        )}

        {/* mount dialog */}
        <Dialog open={mountOpen} onOpenChange={setMountOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("tires.mountAt", { code: selected?.position_code ?? "" })}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("tires.pickTire")}</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={mountTireId}
                  onChange={(e) => setMountTireId(e.target.value)}
                >
                  {(stockTires ?? []).map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.brand} — {tr.dot_code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("tires.reason")}</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={mountReason}
                  onChange={(e) => setMountReason(e.target.value as MountReason)}
                >
                  {MOUNT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`tires.reasons.${r}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mnt-odo">{t("vehicle.odometerKm")}</Label>
                <Input id="mnt-odo" inputMode="numeric" value={mountOdo} onChange={(e) => setMountOdo(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={doMount} disabled={mount.isPending || !mountTireId}>
                {t("tires.mount")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* dismount dialog */}
        <Dialog open={dismountOpen} onOpenChange={setDismountOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("tires.dismountFrom", { code: selected?.position_code ?? "" })}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("tires.reason")}</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={dismountReason}
                  onChange={(e) => setDismountReason(e.target.value as MountReason)}
                >
                  {MOUNT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`tires.reasons.${r}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("tires.sendTo")}</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={dismountTo}
                  onChange={(e) => setDismountTo(e.target.value as Exclude<TireStatus, "mounted">)}
                >
                  {DISMOUNT_TARGETS.map((s) => (
                    <option key={s} value={s}>
                      {t(`tires.statuses.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsm-odo">{t("vehicle.odometerKm")}</Label>
                <Input id="dsm-odo" inputMode="numeric" value={dismountOdo} onChange={(e) => setDismountOdo(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={doDismount} disabled={dismount.isPending}>
                {t("tires.dismount")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
