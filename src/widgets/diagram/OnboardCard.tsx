import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

/** First-time onboarding, as a corner card over the diagram (the truck stays
 * visible — no modal). Legacy origin: no stock deduction, no work order.
 * Optionally applies the same brand to every remaining empty road position. */
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
    <div className="absolute bottom-4 end-4 w-80 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            {t("diagram.onboard.fill", { code: position.position_code })}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("diagram.onboard.subtitle")}</p>
        </div>
        <button
          aria-label={t("common.close")}
          onClick={onClose}
          className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <Label htmlFor="ob-brand" className="text-xs">
            {t("tires.brand")}
          </Label>
          <Input
            id="ob-brand"
            dir="ltr"
            className="h-8"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ob-size" className="text-xs">
            {t("tires.size")}
          </Label>
          <Input id="ob-size" dir="ltr" className="h-8" value={size} onChange={(e) => setSize(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ob-dot" className="text-xs">
            {t("tires.dot")}
          </Label>
          <Input id="ob-dot" dir="ltr" className="h-8" value={dot} onChange={(e) => setDot(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ob-km" className="text-xs">
            {t("tires.intake.estimatedKm")}
          </Label>
          <Input
            id="ob-km"
            inputMode="numeric"
            className="h-8 tabular"
            value={km}
            onChange={(e) => setKm(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
      </div>

      {others > 0 && (
        <label className="mt-3 flex items-center gap-2 text-xs">
          <Checkbox checked={applyAll} onCheckedChange={(v) => setApplyAll(v === true)} />
          {t("diagram.onboard.sameForAll")}
        </label>
      )}

      <Button
        size="sm"
        className="mt-3 w-full"
        disabled={!brand.trim() || onboard.isPending}
        onClick={() => onboard.mutate()}
      >
        {t("common.save")}
      </Button>
    </div>
  );
}
