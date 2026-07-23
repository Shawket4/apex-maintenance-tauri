import { useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation, useStock, useTires } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

/** Mount onto an empty position, inside a WO — rendered in the inspector
 * column (the canvas is never overlaid). Two sources:
 *  - NEW from fungible stock → identity (DOT) is captured NOW; the server
 *    derives the stock debit from the shipment-origin insert.
 *  - USED from the individual pool (in_stock_used assets). */
export function MountForm({
  position,
  vehicleId,
  workOrderId,
  defaultOdometer,
  onClose,
}: {
  position: PositionRow;
  vehicleId: number;
  workOrderId: string;
  defaultOdometer: number | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const stock = useStock();
  const usedPool = useTires("in_stock_used");
  const [stockId, setStockId] = useState<string | null>(null);
  const [usedId, setUsedId] = useState<string | null>(null);
  const [dot, setDot] = useState("");
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");
  // Free-brand path: an empty/stale stock mirror must never block a mount —
  // the copy always promised "continue and the balance goes negative".
  const [customBrand, setCustomBrand] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [size, setSize] = useState("");
  // The USED mount's real reason (recording rotation as "replacement" lied
  // to the history).
  const [usedReason, setUsedReason] = useState("replacement");

  const stockLines = stock.data?.tires ?? [];
  const line = stockLines.find((l) => l.id === stockId);
  const useCustom = customBrand || stockLines.length === 0;
  const newReady = useCustom ? !!brand.trim() : !!line;

  const mountNew = useDomainMutation(
    () =>
      unwrap(
        commands.mountFromStock({
          position_id: position.id,
          vehicle_id: vehicleId,
          work_order_id: workOrderId,
          brand: useCustom ? brand.trim() : line!.brand,
          model: useCustom ? model.trim() || null : line!.model,
          size: useCustom ? size.trim() || null : line!.size,
          dot_code: dot || null,
          odometer: odometer ? Number(odometer) : null,
        }),
      ),
    { onSuccess: onClose, onError: notifyError },
  );

  const mountUsed = useDomainMutation(
    () =>
      unwrap(
        commands.mountUsed({
          tire_id: usedId!,
          position_id: position.id,
          vehicle_id: vehicleId,
          work_order_id: workOrderId,
          odometer: odometer ? Number(odometer) : null,
          reason: usedReason,
        }),
      ),
    { onSuccess: onClose, onError: notifyError },
  );

  return (
      <Tabs defaultValue="new">
        <TabsList className="w-full">
          <TabsTrigger value="new" className="flex-1">
            {t("diagram.mount.fromNew")}
          </TabsTrigger>
          <TabsTrigger value="used" className="flex-1">
            {t("diagram.mount.fromUsed")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-3 pt-3">
          {stockLines.length === 0 ? (
            <p className="text-xs text-status-due_soon">{t("diagram.mount.noStock")}</p>
          ) : !useCustom ? (
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {stockLines.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setStockId(l.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-start text-sm transition",
                    stockId === l.id
                      ? "border-primary bg-primary/5 font-medium"
                      : "hover:bg-accent",
                  )}
                >
                  <span dir="ltr" className="truncate">
                    {l.brand} {l.model ?? ""} {l.size ?? ""}
                  </span>
                  <span
                    className={cn(
                      "ms-2 shrink-0 rounded-full px-2 py-0.5 text-xs tabular",
                      l.projected_qty <= 0
                        ? "bg-status-overdue/10 text-status-overdue"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {fmtNumber(l.projected_qty, i18n.language)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {useCustom && (
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="mount-brand" className="text-xs text-muted-foreground">
                  {t("tires.brand")}
                </Label>
                <Input
                  id="mount-brand"
                  dir="ltr"
                  className="h-9"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </div>
              <Input
                aria-label={t("tires.size")}
                placeholder={t("tires.size")}
                dir="ltr"
                className="h-9"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
              <Input
                aria-label={t("diagram.mount.model")}
                placeholder={t("diagram.mount.model")}
                dir="ltr"
                className="h-9"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          )}
          {stockLines.length > 0 && (
            <button
              onClick={() => setCustomBrand((v) => !v)}
              className="text-xs text-primary hover:underline"
            >
              {customBrand ? t("diagram.mount.pickFromStock") : t("diagram.mount.customBrand")}
            </button>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mount-dot" className="text-xs text-muted-foreground">
              {t("diagram.mount.dotPrompt")}
            </Label>
            <Input id="mount-dot" dir="ltr" className="h-9" value={dot} onChange={(e) => setDot(e.target.value)} />
          </div>
          <OdometerField value={odometer} onChange={setOdometer} />
          <Button
            className="w-full"
            disabled={!newReady || mountNew.isPending}
            onClick={() => mountNew.mutate()}
          >
            {t("diagram.mount.submit")}
          </Button>
        </TabsContent>

        <TabsContent value="used" className="space-y-3 pt-3">
          {(usedPool.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("diagram.mount.noUsed")}</p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {(usedPool.data ?? []).map((tire) => (
                <button
                  key={tire.id}
                  onClick={() => setUsedId(tire.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-start text-sm transition",
                    usedId === tire.id
                      ? "border-primary bg-primary/5 font-medium"
                      : "hover:bg-accent",
                  )}
                >
                  <span dir="ltr" className="truncate">
                    {tire.dot_code ?? `${tire.brand} ${tire.model ?? ""}`}
                  </span>
                  <span className="ms-2 shrink-0 text-xs text-muted-foreground tabular">
                    {fmtNumber(tire.total_km, i18n.language)} {t("common.km")}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("diagram.mount.reason")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {["replacement", "rotation", "repair_return"].map((r) => (
                <button
                  key={r}
                  onClick={() => setUsedReason(r)}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs transition",
                    usedReason === r
                      ? "border-primary bg-primary/5 font-semibold text-primary"
                      : "hover:bg-accent",
                  )}
                >
                  {t(`tires.mountReason.${r}`)}
                </button>
              ))}
            </div>
          </div>
          <OdometerField value={odometer} onChange={setOdometer} />
          <Button
            className="w-full"
            disabled={!usedId || mountUsed.isPending}
            onClick={() => mountUsed.mutate()}
          >
            {t("diagram.mount.submit")}
          </Button>
        </TabsContent>
      </Tabs>
  );
}

function OdometerField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Label htmlFor="mount-odo" className="text-xs text-muted-foreground">
        {t("diagram.mount.odometer")}
      </Label>
      <Input
        id="mount-odo"
        inputMode="numeric"
        className="h-9 tabular"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </div>
  );
}
