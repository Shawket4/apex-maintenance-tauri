/**
 * Template setup — the rules. Mileage XOR time, exactly as the schema CHECK
 * enforces; the form only shows the interval field the trigger needs.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Gauge, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useCategories,
  useTemplateCreate,
  useTemplateDelete,
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
import { fmtNumber } from "@/shared/lib/numbers";

export function TemplatesSection({ vehicleId }: { vehicleId: number }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const { data: templates } = useTemplates(vehicleId);
  const { data: categories } = useCategories();
  const createTemplate = useTemplateCreate(vehicleId);
  const deleteTemplate = useTemplateDelete(vehicleId);

  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [trigger, setTrigger] = useState<"mileage" | "time">("mileage");
  const [intervalKm, setIntervalKm] = useState("10000");
  const [intervalDays, setIntervalDays] = useState("90");

  const pickCategory = (id: string) => {
    setCategoryId(id);
    const cat = (categories ?? []).find((c) => c.id === id);
    // Prefill names from the category — most templates ARE the category.
    if (cat) {
      if (!nameAr) setNameAr(cat.name_ar);
      if (!nameEn) setNameEn(cat.name_en);
    }
  };

  const submit = async () => {
    if (!categoryId || !nameAr || !nameEn) {
      toast.error(t("templates.missingFields"));
      return;
    }
    try {
      await createTemplate.mutateAsync({
        vehicle_id: vehicleId,
        category_id: categoryId,
        name_ar: nameAr,
        name_en: nameEn,
        trigger_type: trigger,
        interval_km: trigger === "mileage" ? Number(intervalKm) : null,
        interval_days: trigger === "time" ? Number(intervalDays) : null,
      });
      toast.success(t("templates.saved"));
      setOpen(false);
      setCategoryId("");
      setNameAr("");
      setNameEn("");
    } catch (e) {
      toast.error(appErrorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{t("templates.title")}</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-4 w-4" />
              {t("templates.add")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("templates.add")}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>{t("records.category")}</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={categoryId}
                  onChange={(e) => pickCategory(e.target.value)}
                >
                  <option value="">—</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {ar ? c.name_ar : c.name_en}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-ar">{t("templates.nameAr")}</Label>
                <Input id="tpl-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-en">{t("templates.nameEn")}</Label>
                <Input id="tpl-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
              <div className="col-span-2 flex gap-2">
                <Button
                  type="button"
                  variant={trigger === "mileage" ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setTrigger("mileage")}
                >
                  <Gauge className="h-3.5 w-3.5" />
                  {t("templates.byMileage")}
                </Button>
                <Button
                  type="button"
                  variant={trigger === "time" ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setTrigger("time")}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {t("templates.byTime")}
                </Button>
              </div>
              {trigger === "mileage" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-km">{t("templates.intervalKm")}</Label>
                  <Input id="tpl-km" inputMode="numeric" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-days">{t("templates.intervalDays")}</Label>
                  <Input id="tpl-days" inputMode="numeric" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={createTemplate.isPending}>
                {t("actions.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border">
        {(templates ?? []).map((tpl) => (
          <div key={tpl.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="min-w-44">{ar ? tpl.name_ar : tpl.name_en}</span>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
              {tpl.trigger_type === "mileage" ? (
                <>
                  <Gauge className="h-3.5 w-3.5" />
                  {t("templates.everyKm", { km: fmtNumber(tpl.interval_km ?? 0) })}
                </>
              ) : (
                <>
                  <CalendarClock className="h-3.5 w-3.5" />
                  {t("templates.everyDays", { days: fmtNumber(tpl.interval_days ?? 0) })}
                </>
              )}
            </span>
            <span className="ms-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                aria-label={t("actions.delete")}
                onClick={async () => {
                  try {
                    await deleteTemplate.mutateAsync(tpl.id);
                    toast.success(t("templates.deleted"));
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
        {(templates ?? []).length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("templates.empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
