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
import { DiagramPanel } from "./DiagramPanel";

/** Mount onto an empty position, inside a WO — corner panel so the zoomed
 * pair stays visible. Two sources:
 *  - NEW from fungible stock → identity (DOT) is captured NOW; the server
 *    derives the stock debit from the shipment-origin insert.
 *  - USED from the individual pool (in_stock_used assets). */
export function MountSheet({
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

  const line = (stock.data?.tires ?? []).find((l) => l.id === stockId);

  const mountNew = useDomainMutation(
    () =>
      unwrap(
        commands.mountFromStock({
          position_id: position.id,
          vehicle_id: vehicleId,
          work_order_id: workOrderId,
          brand: line!.brand,
          model: line!.model,
          size: line!.size,
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
          reason: "replacement",
        }),
      ),
    { onSuccess: onClose, onError: notifyError },
  );

  return (
    <DiagramPanel
      code={position.position_code}
      title={t("diagram.mount.title")}
      onClose={onClose}
    >
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
          {(stock.data?.tires ?? []).length === 0 ? (
            <p className="text-xs text-status-due_soon">{t("diagram.mount.noStock")}</p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {(stock.data?.tires ?? []).map((l) => (
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
            disabled={!line || mountNew.isPending}
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
    </DiagramPanel>
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
