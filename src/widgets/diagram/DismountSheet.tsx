import { useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { TIRE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DiagramPanel } from "./DiagramPanel";

/** Reason → resulting status. MUST mirror the Rust rule (client domain.rs /
 * server side_effects.rs) — shown to the mechanic before confirming. */
const REASON_STATUS: Record<string, string> = {
  worn: "scrapped",
  damaged: "scrapped",
  rotation: "in_stock_used",
  puncture: "in_repair",
  retread: "retreading",
  other: "in_stock_used",
};

export function DismountSheet({
  position,
  workOrderId,
  defaultOdometer,
  onClose,
}: {
  position: PositionRow;
  workOrderId: string;
  defaultOdometer: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<string>("worn");
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");

  const dismount = useDomainMutation(
    () =>
      unwrap(
        commands.dismount({
          assignment_id: position.assignment_id!,
          odometer: odometer ? Number(odometer) : null,
          reason,
          work_order_id: workOrderId,
        }),
      ),
    { onSuccess: onClose, onError: notifyError },
  );

  return (
    <DiagramPanel
      code={position.position_code}
      title={t("diagram.dismount.title")}
      subtitle={position.dot_code ?? position.brand ?? undefined}
      accent="destructive"
      onClose={onClose}
    >
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("diagram.dismount.reason")}</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {Object.keys(REASON_STATUS).map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-xs transition",
                reason === r ? "border-primary bg-primary/5 font-semibold" : "hover:bg-accent",
              )}
            >
              {t(`diagram.reason.${r}`)}
            </button>
          ))}
        </div>
        <p className="pt-1 text-xs text-muted-foreground">
          {t("diagram.dismount.resultStatus")}{" "}
          <span className={cn("rounded-full px-2 py-0.5", TIRE_BADGE[REASON_STATUS[reason]])}>
            {t(`tires.status.${REASON_STATUS[reason]}`)}
          </span>
        </p>
      </div>

      <div className="mt-3 space-y-1.5">
        <Label htmlFor="dis-odo" className="text-xs text-muted-foreground">
          {t("diagram.dismount.odometer")}
        </Label>
        <Input
          id="dis-odo"
          inputMode="numeric"
          className="h-9 tabular"
          value={odometer}
          onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ""))}
        />
      </div>

      <Button
        variant="destructive"
        className="mt-4 w-full"
        disabled={dismount.isPending}
        onClick={() => dismount.mutate()}
      >
        {t("diagram.dismount.submit")}
      </Button>
    </DiagramPanel>
  );
}
