import { useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

/** First-time onboarding: record the rubber already ON the truck. Legacy
 * origin — no stock deduction, no work order required. Optionally apply the
 * same brand to every remaining empty road position in one go. */
export function OnboardSheet({
  position,
  vehicleId,
  emptyPositions,
  onClose,
}: {
  position: PositionRow;
  vehicleId: number;
  emptyPositions: PositionRow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [dot, setDot] = useState("");
  const [km, setKm] = useState("");
  const [applyAll, setApplyAll] = useState(false);

  const onboard = useDomainMutation(
    async () => {
      const targets = applyAll ? emptyPositions : [position];
      let count = 0;
      for (const p of targets) {
        await unwrap(
          commands.onboardPosition({
            position_id: p.id,
            vehicle_id: vehicleId,
            brand: brand.trim(),
            model: null,
            size: size.trim() || null,
            // The DOT belongs to ONE physical tire — never copied in bulk.
            dot_code: p.id === position.id ? dot.trim() || null : null,
            estimated_km: km ? Number(km) : null,
          }),
        );
        count += 1;
      }
      return count;
    },
    {
      onSuccess: (count) => {
        notifySuccess(t("diagram.onboard.done", { count }));
        onClose();
      },
      onError: notifyError,
    },
  );

  const others = emptyPositions.length - 1;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("diagram.onboard.fill", { code: position.position_code })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("diagram.onboard.subtitle")}</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ob-brand">{t("tires.brand")}</Label>
            <Input id="ob-brand" dir="ltr" value={brand} onChange={(e) => setBrand(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ob-size">{t("tires.size")}</Label>
            <Input id="ob-size" dir="ltr" value={size} onChange={(e) => setSize(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ob-dot">{t("tires.dot")}</Label>
            <Input id="ob-dot" dir="ltr" value={dot} onChange={(e) => setDot(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ob-km">{t("tires.intake.estimatedKm")}</Label>
            <Input
              id="ob-km"
              inputMode="numeric"
              className="tabular"
              value={km}
              onChange={(e) => setKm(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
        </div>

        {others > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={applyAll} onCheckedChange={(v) => setApplyAll(v === true)} />
            {t("diagram.onboard.sameForAll")}
          </label>
        )}

        <Button
          className="w-full"
          disabled={!brand.trim() || onboard.isPending}
          onClick={() => onboard.mutate()}
        >
          {t("common.save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
