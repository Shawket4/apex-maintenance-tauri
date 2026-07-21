import { useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { TIRE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

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
  defaultOdometer,
  onClose,
}: {
  position: PositionRow;
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
        }),
      ),
    { onSuccess: onClose, onError: notifyError },
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("diagram.dismount.title", { code: position.position_code })}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg bg-muted/50 p-3 text-sm" dir="ltr">
          {position.dot_code ?? position.brand ?? ""}
        </div>

        <div className="space-y-2">
          <Label>{t("diagram.dismount.reason")}</Label>
          <div className="grid grid-cols-3 gap-2">
            {Object.keys(REASON_STATUS).map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={cn(
                  "rounded-lg border p-2 text-sm transition",
                  reason === r ? "border-primary bg-primary/5 font-semibold" : "hover:bg-accent",
                )}
              >
                {t(`diagram.reason.${r}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("diagram.dismount.resultStatus")}{" "}
            <span className={cn("rounded-full px-2 py-0.5", TIRE_BADGE[REASON_STATUS[reason]])}>
              {t(`tires.status.${REASON_STATUS[reason]}`)}
            </span>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dis-odo">{t("diagram.dismount.odometer")}</Label>
          <Input
            id="dis-odo"
            inputMode="numeric"
            className="tabular"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>

        <Button
          variant="destructive"
          className="w-full"
          disabled={dismount.isPending}
          onClick={() => dismount.mutate()}
        >
          {t("diagram.dismount.submit")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
