/**
 * Maintenance history + the add-record flow. Recording against a template
 * resets its clock (next_due derives in the Rust core from the template
 * interval + this record's odometer/date).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useCategories,
  useRecordCreate,
  useRecordDelete,
  useRecords,
  useTemplates,
} from "@/shared/api/maintenance";
import { appErrorMessage } from "@/shared/api/tauri";
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
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo, nowUtcIso, todayCairoYmd } from "@/shared/lib/time";

export function RecordsSection({
  vehicleId,
  currentOdometer,
}: {
  vehicleId: number;
  currentOdometer: number | null;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const { data: records } = useRecords(vehicleId);
  const { data: templates } = useTemplates(vehicleId);
  const { data: categories } = useCategories();
  const createRecord = useRecordCreate(vehicleId);
  const deleteRecord = useRecordDelete(vehicleId);

  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [date, setDate] = useState<string>(todayCairoYmd());
  const [odometer, setOdometer] = useState<string>("");
  const [cost, setCost] = useState<string>("");
  const [vendor, setVendor] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const selectedTemplate = (templates ?? []).find((x) => x.id === templateId);

  const openWith = () => {
    setOdometer(currentOdometer != null ? String(currentOdometer) : "");
    setDate(todayCairoYmd());
    setOpen(true);
  };

  const submit = async () => {
    const cat = selectedTemplate?.category_id ?? categoryId;
    if (!cat) {
      toast.error(t("records.pickCategory"));
      return;
    }
    try {
      await createRecord.mutateAsync({
        template_id: templateId || null,
        vehicle_id: vehicleId,
        category_id: cat,
        performed_at: date ? `${date}T12:00:00Z` : nowUtcIso(),
        odometer_at_service: odometer ? Number(odometer) : null,
        cost: cost ? Number(cost) : null,
        vendor: vendor || null,
        notes: notes || null,
      });
      toast.success(t("records.saved"));
      setOpen(false);
      setTemplateId("");
      setCategoryId("");
      setCost("");
      setVendor("");
      setNotes("");
    } catch (e) {
      toast.error(appErrorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{t("records.title")}</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" onClick={openWith}>
              <Plus className="h-4 w-4" />
              {t("records.add")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("records.add")}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>{t("records.template")}</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">{t("records.noTemplate")}</option>
                  {(templates ?? []).map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {ar ? tpl.name_ar : tpl.name_en}
                    </option>
                  ))}
                </select>
              </div>
              {!templateId && (
                <div className="col-span-2 space-y-1.5">
                  <Label>{t("records.category")}</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">—</option>
                    {(categories ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {ar ? c.name_ar : c.name_en}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="rec-date">{t("records.date")}</Label>
                <Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-odo">{t("vehicle.odometerKm")}</Label>
                <Input
                  id="rec-odo"
                  inputMode="numeric"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-cost">{t("records.cost")}</Label>
                <Input id="rec-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-vendor">{t("records.vendor")}</Label>
                <Input id="rec-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="rec-notes">{t("common.notes")}</Label>
                <Input id="rec-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={createRecord.isPending}>
                {t("actions.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border">
        {(records ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="text-sm tabular-nums text-muted-foreground min-w-28">
              {fmtCairo(r.performed_at, "YYYY/MM/DD")}
            </span>
            <span className="min-w-40">{ar ? r.category_name_ar : r.category_name_en}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {r.odometer_at_service != null ? fmtKm(r.odometer_at_service) : "—"}
            </span>
            {r.cost != null && (
              <span className="text-sm tabular-nums">{fmtNumber(r.cost)} {t("common.egp")}</span>
            )}
            {r.vendor && <span className="text-xs text-muted-foreground">{r.vendor}</span>}
            <span className="ms-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                aria-label={t("actions.delete")}
                onClick={async () => {
                  try {
                    await deleteRecord.mutateAsync(r.id);
                    toast.success(t("records.deleted"));
                  } catch (e) {
                    toast.error(appErrorMessage(e));
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          </div>
        ))}
        {(records ?? []).length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("records.empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
