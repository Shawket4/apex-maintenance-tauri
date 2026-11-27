import { useTranslation } from "react-i18next";
import { BatteryFull } from "lucide-react";

import type { BatteryFitRow, WoDetail } from "@/shared/api/client";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { BatteryBay, UndoFit, UndoRemoval } from "@/widgets/batteries/BatteryBay";
import { batteryName, batteryRating } from "@/widgets/batteries/lib";
import { ListCard, Section } from "@/widgets/layout/PageShell";

import { ClosedNote, PendingBadge, SectionTitle } from "./parts";

/** Battery work under this order: what was fitted or taken off (with the
 * way back for a mistake), then the truck's slots to do more — bound to this
 * order. A closed order only shows what was done. */
export function WoBatteries({ d, woId, canEdit }: { d: WoDetail; woId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  return (
    <Section
      title={
        <SectionTitle icon={<BatteryFull className="h-4 w-4 text-primary" />}>{t("batteries.wo.title")}</SectionTitle>
      }
    >
      <ListCard>
        {d.battery_ops.length === 0 && (
          <div className="px-4 py-4 text-sm text-muted-foreground">{t("batteries.wo.empty")}</div>
        )}
        {d.battery_ops.map((op) => (
          <OpRow key={op.install_id} op={op} woId={woId} canEdit={canEdit} />
        ))}
        {!canEdit && <ClosedNote />}
      </ListCard>
      {canEdit && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">{t("batteries.wo.slotsTitle")}</h3>
          <BatteryBay vehicleId={d.wo.vehicle_id} wo={{ id: woId, open: true }} />
        </div>
      )}
    </Section>
  );
}

function OpRow({ op, woId, canEdit }: { op: BatteryFitRow; woId: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const removedHere = op.removed_at != null && op.removal_work_order_id === woId;
  const fittedHere = op.work_order_id === woId;
  const state = removedHere
    ? fittedHere
      ? t("batteries.wo.fittedAndRemoved")
      : t("batteries.wo.removed")
    : op.removed_at
      ? t("batteries.wo.fittedRemovedLater")
      : t("batteries.wo.fitted");
  const rating = batteryRating(op.battery);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            {t("batteries.slot", { n: fmtNumber(op.slot, lang) })}
          </span>
          <bdi className="font-semibold">{batteryName(op.battery)}</bdi>
          {rating && (
            <bdi dir="ltr" className="text-muted-foreground">
              {rating}
            </bdi>
          )}
          {(op.pending || op.battery.pending) && <PendingBadge />}
        </div>
        <div className="text-muted-foreground">
          {state}
          {removedHere && op.removal_reason && ` · ${t(`batteries.reason.${op.removal_reason}`)}`}
          {removedHere && op.removal_outcome && ` · ${t(`batteries.outcome.${op.removal_outcome}`)}`}
          {removedHere && op.km != null && ` · ${t("batteries.kmRun", { km: fmtKm(op.km, lang) })}`}
          {op.battery.serial && (
            <>
              {" · "}
              {t("batteries.serialShort")} <bdi dir="ltr" className="whitespace-nowrap">{op.battery.serial}</bdi>
            </>
          )}
        </div>
      </div>
      {canEdit &&
        (removedHere ? (
          op.battery.status !== "installed" && <UndoRemoval fit={op} size="sm" />
        ) : !op.removed_at ? (
          <UndoFit fit={op} size="sm" />
        ) : null)}
    </div>
  );
}
