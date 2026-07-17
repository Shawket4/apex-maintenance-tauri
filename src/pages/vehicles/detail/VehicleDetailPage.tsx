/**
 * The Vehicle page — the hub everything converges on. Order of sections is the
 * workflow, not the schema: the odometer gates the truth (every mileage-based
 * status derives from it), then what's due, then the tire diagram, then
 * history, then setup.
 */

import { useMemo, useState } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileText, Gauge, Pencil } from "lucide-react";

import { useVehiclesQuery } from "@/shared/api/vehicles";
import { useDueList, useOverrideSet } from "@/shared/api/maintenance";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { toast } from "sonner";

import { OdometerBadge, DueBadge, dueDistance } from "@/pages/due/DuePage";
import { RecordsSection } from "./sections/RecordsSection";
import { TemplatesSection } from "./sections/TemplatesSection";
import { TiresSection } from "./sections/TiresSection";
import { appErrorMessage } from "@/shared/api/tauri";
import { fmtKm } from "@/shared/lib/numbers";

export function VehicleDetailPage() {
  const { vehicleId: vehicleIdRaw } = useParams({ strict: false }) as { vehicleId: string };
  const vehicleId = Number(vehicleIdRaw);
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");

  const { data: vehicles } = useVehiclesQuery();
  const vehicle = useMemo(
    () => (vehicles ?? []).find((v) => v.id === vehicleId),
    [vehicles, vehicleId],
  );

  const { data: due } = useDueList(vehicleId);
  const overrideSet = useOverrideSet(vehicleId);
  const [odoOpen, setOdoOpen] = useState(false);
  const [odoValue, setOdoValue] = useState("");
  const [odoNotes, setOdoNotes] = useState("");

  const headItem = due?.[0];

  const submitOverride = async () => {
    const v = Number(odoValue);
    if (!Number.isFinite(v) || v < 0) {
      toast.error(t("vehicle.odometerInvalid"));
      return;
    }
    try {
      await overrideSet.mutateAsync({ odometer: Math.round(v), notes: odoNotes || null });
      toast.success(t("vehicle.odometerSaved"));
      setOdoOpen(false);
      setOdoValue("");
      setOdoNotes("");
    } catch (e) {
      toast.error(appErrorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t("common.back")}
          </Button>
        </Link>
        <h1 className="text-2xl font-bold tabular-nums" dir="rtl">
          {vehicle?.car_no_plate ?? `#${vehicleId}`}
        </h1>
        {vehicle?.car_type && (
          <span className="text-sm text-muted-foreground">{vehicle.car_type}</span>
        )}
        <span className="ms-auto">
          <Link to="/service-invoices/$vehicleId" params={{ vehicleId: String(vehicleId) }}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <FileText className="h-4 w-4" />
              {t("vehicle.invoices")}
            </Button>
          </Link>
        </span>
      </div>

      {/* ── odometer truth ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <Gauge className="h-8 w-8 text-muted-foreground" />
          <div className="flex-1 min-w-52">
            <div className="text-2xl font-bold tabular-nums">
              {headItem ? fmtKm(headItem.current_odometer) : "—"}
            </div>
            {headItem && (
              <OdometerBadge
                item={{
                  current_odometer: headItem.current_odometer,
                  odometer_source: headItem.odometer_source,
                  odometer_observed_at: headItem.odometer_observed_at,
                }}
              />
            )}
            {!headItem && (
              <p className="text-xs text-muted-foreground">{t("vehicle.noTemplatesYet")}</p>
            )}
          </div>
          <Dialog open={odoOpen} onOpenChange={setOdoOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                {t("vehicle.updateReading")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("vehicle.updateReading")}</DialogTitle>
              </DialogHeader>
              <p className="text-xs text-muted-foreground">{t("vehicle.overrideHint")}</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="odo">{t("vehicle.odometerKm")}</Label>
                  <Input
                    id="odo"
                    inputMode="numeric"
                    value={odoValue}
                    onChange={(e) => setOdoValue(e.target.value)}
                    placeholder="486320"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="odo-notes">{t("common.notes")}</Label>
                  <Input
                    id="odo-notes"
                    value={odoNotes}
                    onChange={(e) => setOdoNotes(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submitOverride} disabled={overrideSet.isPending}>
                  {t("actions.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* ── what's due, right now ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("due.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border">
          {(due ?? []).map((item) => (
            <div key={item.template_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <DueBadge status={item.status} />
              <span className="min-w-44">{ar ? item.name_ar : item.name_en}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {item.status !== "never_done" ? dueDistance(t, item) : null}
              </span>
              {item.last_done_at && (
                <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                  {t("vehicle.lastDone")}: {item.last_done_km != null ? fmtKm(item.last_done_km) : ""}
                </span>
              )}
            </div>
          ))}
          {(due ?? []).length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t("vehicle.noTemplatesYet")}</p>
          )}
        </CardContent>
      </Card>

      {/* ── tires: the diagram + actions ───────────────────────────────── */}
      <TiresSection vehicleId={vehicleId} currentOdometer={headItem?.current_odometer ?? null} />

      {/* ── history ────────────────────────────────────────────────────── */}
      <RecordsSection vehicleId={vehicleId} currentOdometer={headItem?.current_odometer ?? null} />

      {/* ── setup ──────────────────────────────────────────────────────── */}
      <TemplatesSection vehicleId={vehicleId} />
    </div>
  );
}
