import { useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type PositionRow } from "@/shared/api/client";
import { useDomainMutation, useStock, useTires } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

/** Mount onto an empty position, inside a WO. Two sources:
 *  - NEW from fungible stock → identity (DOT) is captured NOW, the server
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("diagram.mount.title", { code: position.position_code })}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="new">
          <TabsList className="w-full">
            <TabsTrigger value="new" className="flex-1">
              {t("diagram.mount.fromNew")}
            </TabsTrigger>
            <TabsTrigger value="used" className="flex-1">
              {t("diagram.mount.fromUsed")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{t("diagram.mount.stockLine")}</Label>
              {(stock.data?.tires ?? []).length === 0 ? (
                <p className="text-sm text-status-due_soon">{t("diagram.mount.noStock")}</p>
              ) : (
                <div className="grid gap-2">
                  {(stock.data?.tires ?? []).map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setStockId(l.id)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-3 text-start text-sm transition",
                        stockId === l.id ? "border-primary bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <span dir="ltr">
                        {l.brand} {l.model ?? ""} {l.size ?? ""}
                      </span>
                      <span
                        className={cn(
                          "tabular text-xs",
                          l.projected_qty <= 0 ? "text-status-overdue" : "text-muted-foreground",
                        )}
                      >
                        {fmtNumber(l.projected_qty, i18n.language)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mount-dot">{t("diagram.mount.dotPrompt")}</Label>
              <Input
                id="mount-dot"
                dir="ltr"
                value={dot}
                onChange={(e) => setDot(e.target.value)}
              />
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

          <TabsContent value="used" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{t("diagram.mount.fromUsed")}</Label>
              {(usedPool.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("diagram.mount.noUsed")}</p>
              ) : (
                <div className="grid max-h-56 gap-2 overflow-y-auto">
                  {(usedPool.data ?? []).map((tire) => (
                    <button
                      key={tire.id}
                      onClick={() => setUsedId(tire.id)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-3 text-start text-sm transition",
                        usedId === tire.id ? "border-primary bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <span dir="ltr">{tire.dot_code ?? `${tire.brand} ${tire.model ?? ""}`}</span>
                      <span className="tabular text-xs text-muted-foreground">
                        {fmtNumber(tire.total_km, i18n.language)} {t("common.km")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
      </DialogContent>
    </Dialog>
  );
}

function OdometerField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor="mount-odo">{t("diagram.mount.odometer")}</Label>
      <Input
        id="mount-odo"
        inputMode="numeric"
        className="tabular"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </div>
  );
}
