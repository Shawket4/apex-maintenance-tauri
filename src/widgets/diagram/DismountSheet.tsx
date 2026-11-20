import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { REASON_STATUS } from "@/shared/lib/status";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";
import { tireName } from "@/widgets/TruckDiagram/layout";

import { Note, RadioCard } from "./Workbench";

/** Take a tire off its wheel, inside an open work order.
 *
 * The reason decides what happens to the tire (worn/damaged → scrapped), so
 * there is NO default: the person picks, reads what it means, and a reason
 * that scraps the tire asks once more before it is saved. */
export function DismountForm({
  position,
  workOrderId,
  defaultOdometer,
  onDone,
  onDirtyChange,
}: {
  position: PositionRow;
  workOrderId: string;
  /** The truck's current odometer, prefilled. */
  defaultOdometer: number | null;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [reason, setReason] = useState<string | null>(null);
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");
  const [confirmScrap, setConfirmScrap] = useState(false);

  const assignmentId = position.assignment_id;
  const km = parseIntInput(odometer);
  const mountedKm = position.mounted_odometer;
  const backwards = km != null && mountedKm != null && km < mountedKm;
  const scraps = reason != null && REASON_STATUS[reason] === "scrapped";

  useEffect(() => {
    onDirtyChange?.(reason != null);
  }, [reason, onDirtyChange]);

  const dismount = useDomainMutation(
    () =>
      unwrap(
        commands.dismount({
          assignment_id: assignmentId!,
          odometer: km,
          reason: reason!,
          work_order_id: workOrderId,
        }),
      ),
    {
      onSuccess: () => {
        setConfirmScrap(false);
        notifySuccess(t(`diagram.dismount.done.${REASON_STATUS[reason!]}`));
        onDone();
      },
      onError: (e) => {
        setConfirmScrap(false);
        notifyError(e);
      },
    },
  );

  const ready = reason != null && assignmentId != null && !backwards;
  const submit = () => {
    if (!ready) return;
    if (scraps) setConfirmScrap(true);
    else dismount.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div id="dis-reason" className="text-sm font-semibold">
          {t("diagram.dismount.reasonPrompt")}
        </div>
        <div role="radiogroup" aria-labelledby="dis-reason" className="grid gap-2">
          {Object.keys(REASON_STATUS).map((r) => (
            <RadioCard
              key={r}
              checked={reason === r}
              onSelect={() => setReason(r)}
              tone={REASON_STATUS[r] === "scrapped" ? "danger" : "default"}
              disabled={dismount.isPending}
              title={t(`diagram.reason.${r}`)}
              description={t(`diagram.outcome.${REASON_STATUS[r]}`)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dis-odo">{t("diagram.field.odometerNow")}</Label>
        <NumberInput
          id="dis-odo"
          value={odometer}
          onValueChange={setOdometer}
          aria-invalid={backwards || undefined}
          aria-describedby="dis-odo-note"
        />
        <div id="dis-odo-note">
          {backwards ? (
            <Note tone="error">{t("diagram.dismount.backwards", { km: fmtNumber(mountedKm, lang) })}</Note>
          ) : km == null && !position.is_spare ? (
            <Note tone="warn">{t("diagram.field.odometerMissing")}</Note>
          ) : mountedKm != null ? (
            <Note>{t("diagram.dismount.mountedAt", { km: fmtNumber(mountedKm, lang) })}</Note>
          ) : null}
        </div>
      </div>

      {reason == null && <Note>{t("diagram.dismount.pickFirst")}</Note>}
      <Button
        variant="destructive"
        className="w-full"
        disabled={!ready || dismount.isPending}
        onClick={submit}
      >
        {dismount.isPending && <Loader2 className="animate-spin" />}
        {scraps ? t("diagram.dismount.submitScrap") : t("diagram.dismount.submit")}
      </Button>

      <ConfirmDialog
        open={confirmScrap}
        onOpenChange={setConfirmScrap}
        title={t("diagram.dismount.scrapTitle")}
        description={t("diagram.dismount.scrapBody", {
          tire: tireName(position) || t("diagram.tire.unknownBrand"),
          reason: reason ? t(`diagram.reason.${reason}`) : "",
        })}
        confirmLabel={t("diagram.dismount.scrapConfirm")}
        destructive
        pending={dismount.isPending}
        onConfirm={() => dismount.mutate()}
      />
    </div>
  );
}
