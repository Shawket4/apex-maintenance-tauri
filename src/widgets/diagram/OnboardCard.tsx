import { useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DiagramPanel } from "./DiagramPanel";

/** First-time onboarding, in the corner panel — the zoomed pair stays
 * visible while you read the sidewall. Legacy origin: no stock deduction,
 * no work order. Optionally applies the same brand to every remaining
 * empty road position. */
export function OnboardCard({
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
  const { t, i18n } = useTranslation();
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
    <DiagramPanel
      code={position.position_code}
      title={t("diagram.onboard.title")}
      subtitle={t("diagram.onboard.subtitle")}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ob-brand" className="text-xs text-muted-foreground">
            {t("tires.brand")}
          </Label>
          <Input
            id="ob-brand"
            dir="ltr"
            className="h-9"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-size" className="text-xs text-muted-foreground">
            {t("tires.size")}
          </Label>
          <Input
            id="ob-size"
            dir="ltr"
            className="h-9"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="ob-dot" className="text-xs text-muted-foreground">
            {t("diagram.mount.dotPrompt")}
          </Label>
          <Input id="ob-dot" dir="ltr" className="h-9" value={dot} onChange={(e) => setDot(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="ob-km" className="text-xs text-muted-foreground">
            {t("tires.intake.estimatedKm")}
          </Label>
          <Input
            id="ob-km"
            inputMode="numeric"
            className="h-9 tabular"
            value={km}
            onChange={(e) => setKm(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
      </div>

      {others > 0 && (
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
          <Checkbox checked={applyAll} onCheckedChange={(v) => setApplyAll(v === true)} />
          <span>
            {t("diagram.onboard.sameForAll")}
            <span className="ms-1 text-muted-foreground tabular">
              ({fmtNumber(others + 1, i18n.language)})
            </span>
          </span>
        </label>
      )}

      <Button
        className="mt-4 w-full"
        disabled={!brand.trim() || onboard.isPending}
        onClick={() => onboard.mutate()}
      >
        {t("common.save")}
      </Button>
    </DiagramPanel>
  );
}
