import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BatteryFull, Info, Loader2, Minus, Pencil, Plus, Undo2 } from "lucide-react";

import { commands, unwrap, type BatteryFitRow, type BatteryRow, type BatterySlot } from "@/shared/api/client";
import { useBatteryTruck, useDomainMutation, useTruck, useWos } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { StatusChip } from "@/shared/ui/status-chip";
import { EmptyState } from "@/widgets/layout/PageShell";

import {
  EditBatteryDialog,
  FitBatteryDialog,
  RegisterBatteryDialog,
  RemoveBatteryDialog,
} from "./BatteryDialogs";
import {
  BATTERY_BADGE,
  BATTERY_OFF_STATUSES,
  MAX_BATTERY_SLOTS,
  batteryName,
  batteryRating,
  fmtYmd,
  warrantyPast,
} from "./lib";

/** The truck page's Batteries tab. */
export function TruckBatteriesTab() {
  const { t } = useTranslation();
  const { truckId } = useParams({ from: "/_app/trucks/$truckId/batteries" });
  const vid = Number(truckId);
  if (!Number.isInteger(vid) || vid <= 0) return <EmptyState>{t("common.notFound")}</EmptyState>;
  return <BatteryBay vehicleId={vid} />;
}

/** A truck's numbered battery slots, each with what is fitted in it, the
 * number of slots, and (on the truck page) what came off it.
 *
 * Fitting is work-order work (it restarts the battery due date): on the
 * truck page it goes under the truck's open work order, inside a work order
 * under that one (`wo`). Registering a battery that is already on the truck,
 * and taking one off, do not need a work order. A closed work order only
 * shows. */
export function BatteryBay({ vehicleId, wo }: { vehicleId: number; wo?: { id: string; open: boolean } }) {
  const { t } = useTranslation();
  const bay = useBatteryTruck(vehicleId);
  const truck = useTruck(vehicleId);
  const openWos = useWos("open", vehicleId);
  const odometer = truck.data?.odometer?.km ?? null;

  const readOnly = !!wo && !wo.open;
  const openWoId = wo ? (wo.open ? wo.id : null) : (openWos.data?.[0]?.id ?? null);
  const checkingWo = !wo && openWos.isPending;

  const [fitting, setFitting] = useState<number | null>(null);
  const [registering, setRegistering] = useState<number | null>(null);
  const [removing, setRemoving] = useState<BatteryFitRow | null>(null);
  const [editing, setEditing] = useState<BatteryRow | null>(null);

  return (
    <QueryState query={bay} skeleton={<Skeleton className="h-64 rounded-xl" />}>
      {(data) => {
        const highest = Math.max(0, ...data.slots.filter((s) => s.fit).map((s) => s.slot));
        return (
          <div className="space-y-4">
            {!wo && !checkingWo && (
              <p className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm leading-relaxed">
                <Info aria-hidden className="mt-0.5 h-4 w-4 flex-none text-info" />
                <span>
                  {openWoId ? (
                    <>
                      {t("batteries.bay.underOpenWo")}{" "}
                      <Link
                        to="/wo/$woId"
                        params={{ woId: openWoId }}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        {t("batteries.bay.goWo")}
                      </Link>
                    </>
                  ) : (
                    t("batteries.bay.noOpenWo")
                  )}
                </span>
              </p>
            )}

            <ul className="grid items-start gap-3 sm:grid-cols-2">
              {data.slots.map((s) => (
                <SlotCard
                  key={s.slot}
                  slot={s}
                  readOnly={readOnly}
                  canFit={!!openWoId}
                  checking={checkingWo}
                  // Inside a work order its own fittings are undone from its list.
                  allowUndo={!wo}
                  onFit={() => setFitting(s.slot)}
                  onRegister={() => setRegistering(s.slot)}
                  onRemove={(f) => setRemoving(f)}
                  onEdit={(b) => setEditing(b)}
                />
              ))}
            </ul>

            <SlotsControl
              vehicleId={vehicleId}
              count={data.slots.length}
              minimum={Math.max(1, highest)}
              pending={data.layout_pending}
              disabled={readOnly}
            />

            {!wo && <RemovedList removed={data.removed} slots={data.slots} />}

            {fitting != null && openWoId && (
              <FitBatteryDialog
                vehicleId={vehicleId}
                slot={fitting}
                workOrderId={openWoId}
                defaultOdometer={odometer}
                onClose={() => setFitting(null)}
              />
            )}
            {registering != null && (
              <RegisterBatteryDialog
                vehicleId={vehicleId}
                slot={registering}
                defaultOdometer={odometer}
                onClose={() => setRegistering(null)}
              />
            )}
            {removing && (
              <RemoveBatteryDialog
                fit={removing}
                workOrderId={openWoId}
                defaultOdometer={odometer}
                onClose={() => setRemoving(null)}
              />
            )}
            {editing && <EditBatteryDialog battery={editing} onClose={() => setEditing(null)} />}
          </div>
        );
      }}
    </QueryState>
  );
}

function SlotTag({ n }: { n: number }) {
  const { t, i18n } = useTranslation();
  return (
    <span className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
      <BatteryFull aria-hidden className="h-3.5 w-3.5" />
      {t("batteries.slot", { n: fmtNumber(n, i18n.language) })}
    </span>
  );
}

function SlotCard({
  slot,
  readOnly,
  allowUndo,
  canFit,
  checking,
  onFit,
  onRegister,
  onRemove,
  onEdit,
}: {
  slot: BatterySlot;
  readOnly: boolean;
  allowUndo: boolean;
  canFit: boolean;
  checking: boolean;
  onFit: () => void;
  onRegister: () => void;
  onRemove: (f: BatteryFitRow) => void;
  onEdit: (b: BatteryRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const f = slot.fit;

  if (!f) {
    return (
      <li className="flex flex-col gap-3 rounded-xl border border-dashed bg-card/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <SlotTag n={slot.slot} />
          <span className="text-sm text-muted-foreground">{t("batteries.bay.empty")}</span>
        </div>
        {readOnly ? null : (
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button disabled={!canFit || checking} onClick={onFit}>
              {checking ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("batteries.bay.fit")}
            </Button>
            <Button variant="outline" onClick={onRegister}>
              {t("batteries.bay.register")}
            </Button>
          </div>
        )}
      </li>
    );
  }

  const b = f.battery;
  const rating = batteryRating(b, true);
  const expired = warrantyPast(b.warranty_until);
  return (
    <li className="flex flex-col rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SlotTag n={slot.slot} />
        {(f.pending || b.pending) && <Badge variant="outline">{t("batteries.pending")}</Badge>}
      </div>
      <div className="mt-2.5 text-base font-bold">
        <bdi>{batteryName(b)}</bdi>
      </div>
      {rating && (
        <div className="text-sm text-muted-foreground">
          <bdi dir="ltr">{rating}</bdi>
        </div>
      )}
      {expired && (
        <p className="mt-2 rounded-md bg-status-overdue-soft px-2.5 py-1.5 text-sm font-semibold text-status-overdue">
          {t("batteries.warrantyEnded", { date: fmtYmd(b.warranty_until!, lang) })}
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        <Fact label={t("batteries.field.serial")}>
          {b.serial ? <bdi dir="ltr">{b.serial}</bdi> : <span className="text-muted-foreground">{t("batteries.none")}</span>}
        </Fact>
        <Fact label={t("batteries.field.dateCode")}>
          {b.date_code ? (
            <bdi dir="ltr">{b.date_code}</bdi>
          ) : (
            <span className="text-muted-foreground">{t("batteries.none")}</span>
          )}
        </Fact>
        <Fact label={t("batteries.warrantyLabel")}>
          {b.warranty_until ? (
            <span className={cn(expired && "text-status-overdue")}>{fmtYmd(b.warranty_until, lang)}</span>
          ) : (
            <span className="text-muted-foreground">{t("batteries.none")}</span>
          )}
        </Fact>
        <Fact label={t("batteries.fittedOn")}>{fmtCairo(f.installed_at, "YYYY/MM/DD", lang)}</Fact>
        <Fact label={t("batteries.fittedOdo")}>
          {f.installed_odometer != null ? fmtKm(f.installed_odometer, lang) : t("batteries.noKm")}
        </Fact>
        <Fact label={t("batteries.kmSinceLabel")}>{f.km != null ? fmtKm(f.km, lang) : t("batteries.noKm")}</Fact>
      </dl>
      {readOnly ? null : (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => onRemove(f)}>
            {t("batteries.bay.remove")}
          </Button>
          {allowUndo && <UndoFit fit={f} />}
          <Button variant="ghost" onClick={() => onEdit(b)}>
            <Pencil />
            {t("batteries.edit.open")}
          </Button>
        </div>
      )}
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold tabular">{children}</dd>
    </div>
  );
}

/** The wrong battery, or the wrong slot: as if it was never fitted. */
export function UndoFit({ fit, size = "default" }: { fit: BatteryFitRow; size?: "default" | "sm" }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const undo = useDomainMutation(() => unwrap(commands.batteryFitUndo(fit.install_id)), {
    onSuccess: () => {
      setOpen(false);
      notifySuccess(t("batteries.undoFit.done"));
    },
    onError: (e) => {
      setOpen(false);
      notifyError(e);
    },
  });
  return (
    <>
      <Button variant="ghost" size={size} disabled={undo.isPending} onClick={() => setOpen(true)}>
        {undo.isPending ? <Loader2 className="animate-spin" /> : <Undo2 aria-hidden />}
        {t("batteries.undoFit.action")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("batteries.undoFit.title")}
        description={t("batteries.undoFit.body", { n: fmtNumber(fit.slot, i18n.language) })}
        confirmLabel={t("batteries.undoFit.action")}
        pending={undo.isPending}
        onConfirm={() => undo.mutate()}
      />
    </>
  );
}

/** The wrong battery was taken off: back where it was, if nothing has
 * happened to it since and its slot is still free (the app checks again). */
export function UndoRemoval({ fit, size = "default" }: { fit: BatteryFitRow; size?: "default" | "sm" }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const undo = useDomainMutation(() => unwrap(commands.batteryRemoveUndo(fit.install_id)), {
    onSuccess: () => {
      setOpen(false);
      notifySuccess(t("batteries.undoRemoval.done"));
    },
    onError: (e) => {
      setOpen(false);
      notifyError(e);
    },
  });
  return (
    <>
      <Button variant="outline" size={size} disabled={undo.isPending} onClick={() => setOpen(true)}>
        {undo.isPending ? <Loader2 className="animate-spin" /> : <Undo2 aria-hidden />}
        {t("batteries.undoRemoval.action")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("batteries.undoRemoval.title")}
        description={t("batteries.undoRemoval.body", { n: fmtNumber(fit.slot, i18n.language) })}
        confirmLabel={t("batteries.undoRemoval.action")}
        pending={undo.isPending}
        onConfirm={() => undo.mutate()}
      />
    </>
  );
}

/** How many battery slots the truck has: never fewer than the highest slot
 * with a battery in it, at most 12. Each step is saved at once. */
function SlotsControl({
  vehicleId,
  count,
  minimum,
  pending,
  disabled,
}: {
  vehicleId: number;
  count: number;
  minimum: number;
  pending: boolean;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const set = useDomainMutation((n: number) => unwrap(commands.batterySlotsSet(vehicleId, n)), {
    onSuccess: (_d, n) => notifySuccess(t("batteries.slots.saved", { n: fmtNumber(n, lang) })),
    onError: notifyError,
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {t("batteries.slots.title")}
          {pending && <Badge variant="outline">{t("batteries.pending")}</Badge>}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {count <= minimum && minimum > 1 ? t("batteries.slots.inUse") : t("batteries.slots.hint")}
        </p>
      </div>
      <div className="flex flex-none items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("batteries.slots.less")}
          disabled={disabled || set.isPending || count <= minimum}
          onClick={() => set.mutate(count - 1)}
        >
          <Minus />
        </Button>
        <span className="min-w-10 text-center text-lg font-bold tabular" aria-live="polite">
          {fmtNumber(count, lang)}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("batteries.slots.more")}
          disabled={disabled || set.isPending || count >= MAX_BATTERY_SLOTS}
          onClick={() => set.mutate(count + 1)}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

/** Batteries taken off this truck, newest first: when, at what km, how far
 * they ran here, why and where they went — with the way back for a mistake,
 * and where a battery that is off a truck is now. */
function RemovedList({ removed, slots }: { removed: BatteryFitRow[]; slots: BatterySlot[] }) {
  const { t } = useTranslation();
  // Only a battery's latest removal can be undone or moved on from.
  const seen = new Set<string>();
  const rows = removed.map((f) => {
    const latest = !seen.has(f.battery.id);
    seen.add(f.battery.id);
    return { f, latest };
  });
  return (
    <section aria-labelledby="battery-removed" className="space-y-2">
      <h2 id="battery-removed" className="text-base font-bold">
        {t("batteries.removed.title")}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{t("batteries.removed.empty")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {rows.map(({ f, latest }) => {
            const offNow = f.battery.status !== "installed";
            const slotFree = slots.some((s) => s.slot === f.slot && !s.fit);
            return (
              <RemovedRow key={f.install_id} fit={f} canUndo={latest && offNow && slotFree} canMove={latest && offNow} />
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function RemovedRow({ fit: f, canUndo, canMove }: { fit: BatteryFitRow; canUndo: boolean; canMove: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const b = f.battery;
  const rating = batteryRating(b);
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SlotTag n={f.slot} />
        <bdi className="font-semibold">{batteryName(b)}</bdi>
        {rating && (
          <bdi dir="ltr" className="text-sm text-muted-foreground">
            {rating}
          </bdi>
        )}
        <StatusChip tone={BATTERY_BADGE[b.status] ?? "bg-muted"}>{t(`batteries.status.${b.status}`)}</StatusChip>
        {(f.pending || b.pending) && <Badge variant="outline">{t("batteries.pending")}</Badge>}
      </div>
      <div className="text-sm text-muted-foreground">
        <p>
          {t("batteries.removed.when", {
            date: fmtCairo(f.removed_at, "YYYY/MM/DD", lang),
            km: f.removed_odometer != null ? fmtKm(f.removed_odometer, lang) : t("batteries.noKm"),
          })}
          {f.km != null && ` · ${t("batteries.kmRun", { km: fmtKm(f.km, lang) })}`}
        </p>
        <p>
          {f.removal_reason && t("batteries.removed.why", { reason: t(`batteries.reason.${f.removal_reason}`) })}
          {f.removal_reason && f.removal_outcome && " · "}
          {f.removal_outcome && t("batteries.removed.went", { place: t(`batteries.outcome.${f.removal_outcome}`) })}
        </p>
        {b.serial && (
          <p>
            {t("batteries.serialShort")} <bdi dir="ltr" className="whitespace-nowrap">{b.serial}</bdi>
          </p>
        )}
      </div>
      {(canUndo || canMove) && (
        <div className="flex flex-wrap items-center gap-2">
          {canUndo && <UndoRemoval fit={f} size="sm" />}
          {canMove && <BatteryStatusActions battery={b} />}
        </div>
      )}
    </li>
  );
}

/** Where a battery that is off a truck is now: charged and back in stock, a
 * warranty claim, scrapped (or back from any of those). */
export function BatteryStatusActions({ battery }: { battery: BatteryRow }) {
  const { t } = useTranslation();
  const set = useDomainMutation((status: string) => unwrap(commands.batterySetStatus(battery.id, status)), {
    onSuccess: (_d, status) => notifySuccess(t("batteries.setStatus.done", { status: t(`batteries.status.${status}`) })),
    onError: notifyError,
  });
  if (battery.status === "installed") return null;
  return (
    <div role="group" aria-label={t("batteries.setStatus.label")} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t("batteries.setStatus.label")}</span>
      {BATTERY_OFF_STATUSES.filter((s) => s !== battery.status).map((s) => (
        <Button key={s} variant="outline" size="sm" disabled={set.isPending} onClick={() => set.mutate(s)}>
          {set.isPending && set.variables === s && <Loader2 className="animate-spin" />}
          {t(`batteries.setStatus.${s}`)}
        </Button>
      ))}
    </div>
  );
}
