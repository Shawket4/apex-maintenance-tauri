import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";

import { Note } from "./Workbench";

/** Register a tire that is ALREADY on the truck (first-time setup): no stock
 * change, no work order. Optionally the same details for every other empty
 * road wheel — that asks first, says how many, and needs the odometer so km
 * can be counted from now on. */
export function OnboardForm({
  position,
  vehicleId,
  emptyRoadPositions,
  defaultOdometer,
  onDone,
  onDirtyChange,
}: {
  position: PositionRow;
  vehicleId: number;
  /** Every empty wheel that is not a spare (spares are never filled in bulk). */
  emptyRoadPositions: PositionRow[];
  /** The truck's current odometer, prefilled. */
  defaultOdometer: number | null;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [size, setSize] = useState("");
  const [dot, setDot] = useState("");
  const [ranKm, setRanKm] = useState("");
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");
  const [applyAll, setApplyAll] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  // This wheel first (it may be a spare), then the other empty road wheels.
  const allTargets = [position, ...emptyRoadPositions.filter((p) => p.id !== position.id)];
  const targets = applyAll ? allTargets : [position];
  const km = parseIntInput(odometer);
  const odometerNeeded = applyAll && km == null;

  const dirty = !!(brand.trim() || model.trim() || size.trim() || dot.trim() || ranKm.trim());
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const onboard = useDomainMutation(
    async () => {
      let count = 0;
      try {
        for (const p of targets) {
          await unwrap(
            commands.onboardPosition({
              position_id: p.id,
              vehicle_id: vehicleId,
              brand: brand.trim(),
              model: model.trim() || null,
              size: size.trim() || null,
              // A DOT belongs to ONE tire — never copied to the others.
              dot_code: p.id === position.id ? dot.trim() || null : null,
              estimated_km: parseIntInput(ranKm),
              odometer: km,
            }),
          );
          count += 1;
        }
      } catch (e) {
        // Some wheels may already be saved: say how many, and show them.
        if (count > 0) notifySuccess(t("diagram.onboard.partial", { n: fmtNumber(count, lang) }));
        void qc.invalidateQueries();
        throw e;
      }
      return count;
    },
    {
      onSuccess: (count) => {
        setConfirmAll(false);
        notifySuccess(
          count === 1 ? t("diagram.onboard.doneOne") : t("diagram.onboard.doneMany", { n: fmtNumber(count, lang) }),
        );
        onDone();
      },
      onError: (e) => {
        setConfirmAll(false);
        notifyError(e);
      },
    },
  );

  const ready = !!brand.trim() && !odometerNeeded;
  const submit = () => {
    if (!ready) return;
    if (applyAll && targets.length > 1) setConfirmAll(true);
    else onboard.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-brand">{t("tires.brand")}</Label>
          <Input id="ob-brand" dir="ltr" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-size">{t("tires.size")}</Label>
          <Input id="ob-size" dir="ltr" value={size} onChange={(e) => setSize(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-model">{t("diagram.field.model")}</Label>
          <Input id="ob-model" dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-dot">{t("diagram.field.dot")}</Label>
          <Input id="ob-dot" dir="ltr" autoComplete="off" value={dot} onChange={(e) => setDot(e.target.value)} />
          <Note>{t("diagram.field.dotHint")}</Note>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-ran">{t("diagram.onboard.ranKm")}</Label>
          <NumberInput id="ob-ran" value={ranKm} onValueChange={setRanKm} />
          <Note>{t("diagram.onboard.ranKmHint")}</Note>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ob-odo">{t("diagram.field.odometerNow")}</Label>
          <NumberInput
            id="ob-odo"
            value={odometer}
            onValueChange={setOdometer}
            aria-invalid={odometerNeeded || undefined}
          />
          {odometerNeeded ? (
            <Note tone="error">{t("diagram.onboard.odometerRequired")}</Note>
          ) : km == null && !position.is_spare ? (
            <Note tone="warn">{t("diagram.field.odometerMissing")}</Note>
          ) : null}
        </div>
      </div>

      {allTargets.length > 1 && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id="ob-all"
              className="size-5"
              checked={applyAll}
              disabled={onboard.isPending}
              onCheckedChange={(v) => setApplyAll(v === true)}
            />
            <Label htmlFor="ob-all" className="cursor-pointer leading-relaxed">
              {t("diagram.onboard.sameForAll", { n: fmtNumber(allTargets.length, lang) })}
            </Label>
          </div>
          {applyAll && <Note>{t("diagram.onboard.sameForAllHint")}</Note>}
        </div>
      )}

      <Button className="w-full" disabled={!ready || onboard.isPending} onClick={submit}>
        {onboard.isPending && <Loader2 className="animate-spin" />}
        {applyAll && targets.length > 1
          ? t("diagram.onboard.submitMany", { n: fmtNumber(targets.length, lang) })
          : t("diagram.onboard.submitOne")}
      </Button>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t("diagram.onboard.confirmTitle", { n: fmtNumber(targets.length, lang) })}
        description={t("diagram.onboard.confirmBody", {
          n: fmtNumber(targets.length, lang),
          brand: [brand.trim(), model.trim(), size.trim()].filter(Boolean).join(" "),
          km: fmtNumber(km, lang),
        })}
        confirmLabel={t("diagram.onboard.confirmYes", { n: fmtNumber(targets.length, lang) })}
        pending={onboard.isPending}
        onConfirm={() => onboard.mutate()}
      />
    </div>
  );
}
