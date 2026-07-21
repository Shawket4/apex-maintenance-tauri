import { useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Droplet, CheckCircle2, Truck, Gauge, CalendarClock } from "lucide-react";
import { maintApi, type Category } from "@/shared/api/maint";
import { appErrorMessage } from "@/shared/api/tauri";
import { toast } from "@/shared/lib/toast-store";
import { fmtNumber } from "@/shared/lib/numbers";
import { dayjs } from "@/shared/lib/time";
import { InvoiceReceipt } from "@/widgets/InvoiceReceipt/InvoiceReceipt";

/** Category id → Arabic name, for the receipt's notes column. */
function catName(cats: Category[] | undefined, id: string) {
  return cats?.find((c) => c.id === id)?.name_ar ?? id;
}

export function WorkOrderDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const qc = useQueryClient();

  const wo = useQuery({ queryKey: ["work-order", id], queryFn: () => maintApi.workOrder(id) });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => maintApi.categories() });
  const oilStock = useQuery({ queryKey: ["stock-oil"], queryFn: () => maintApi.stockOil() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["work-order", id] });
    qc.invalidateQueries({ queryKey: ["work-orders"] });
  };

  const addTask = useMutation({
    mutationFn: (v: { cat: string | null; desc: string }) => maintApi.addTask(id, v.cat, v.desc),
    onSuccess: invalidate,
    onError: (e) => toast.error(appErrorMessage(e)),
  });
  const addOil = useMutation({
    mutationFn: (v: { oil: string; liters: number; odo?: number }) =>
      maintApi.addOilChange(id, wo.data!.work_order.vehicle_id, v.oil, v.liters, v.odo),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["stock-oil"] });
    },
    onError: (e) => toast.error(appErrorMessage(e)),
  });
  const close = useMutation({
    mutationFn: () => maintApi.closeWorkOrder(id, wo.data!.work_order.sync_version),
    onSuccess: () => {
      invalidate();
      toast.success("تم إقفال أمر الشغل");
    },
    onError: (e) => toast.error(appErrorMessage(e)),
  });

  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("");
  const [oilType, setOilType] = useState("");
  const [liters, setLiters] = useState("");

  if (wo.isLoading) return <div className="p-6">…تحميل</div>;
  if (!wo.data) return <div className="p-6">غير موجود</div>;
  const w = wo.data.work_order;
  const litersNum = Number(liters);
  const flagged = liters !== "" && (litersNum < 34 || litersNum > 36);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <button onClick={() => navigate({ to: "/" })} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowRight className="h-4 w-4" /> رجوع
      </button>

      {/* Same receipt layout as service invoices — tasks + oil changes are the line items */}
      <div className="mb-6">
        <InvoiceReceipt
          title={w.title || `أمر شغل #${String(w.id).slice(0, 8)}`}
          subtitle="شركة أبيكس للنقل"
          primaryHeader="البند"
          secondaryHeader="ملاحظات"
          stats={[
            { label: "العربية", value: `#${w.vehicle_id}`, icon: Truck, tone: "primary" },
            { label: "العداد", value: w.odometer_at_open != null ? `${fmtNumber(w.odometer_at_open)} كم` : "—", icon: Gauge, tone: "success" },
            { label: "التاريخ", value: dayjs(w.opened_at).format("D MMM YYYY"), icon: CalendarClock },
            {
              label: "الحالة",
              value: w.status === "open" ? "مفتوح" : "مقفول",
              icon: CheckCircle2,
              tone: w.status === "open" ? "warning" : "success",
            },
          ]}
          items={[
            ...wo.data.tasks.map((t) => ({
              primary: t.description_ar || t.description_en || "بند",
              secondary: t.category_id ? catName(cats.data, t.category_id) : null,
            })),
            ...wo.data.oil_changes.map((o) => ({
              primary: `تغيير زيت — ${o.oil_type}`,
              secondary: `${o.liters} لتر${o.flagged ? " ⚠︎ خارج النطاق" : ""}`,
              highlight: o.flagged,
            })),
          ]}
          emptyText="لا توجد بنود بعد"
        />
      </div>

      {w.status === "open" && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <div className="mb-2 flex gap-2">
            <select className="rounded-md border bg-background p-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">بدون تصنيف</option>
              {(cats.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name_ar}</option>
              ))}
            </select>
            <input className="flex-1 rounded-md border bg-background p-2 text-sm" placeholder="وصف البند…" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <button
              disabled={!desc || addTask.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              onClick={() => { addTask.mutate({ cat: cat || null, desc }); setDesc(""); }}
            >
              إضافة
            </button>
          </div>
        </div>
      )}

      {w.status === "open" && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Droplet className="h-4 w-4" /> تغيير الزيت
          </h2>
          <div className="flex gap-2">
            <select className="rounded-md border bg-background p-2 text-sm" value={oilType} onChange={(e) => setOilType(e.target.value)}>
              <option value="">نوع الزيت</option>
              {(oilStock.data ?? []).map((s) => (
                <option key={s.oil_type} value={s.oil_type}>{s.oil_type} ({s.liters_on_hand} لتر)</option>
              ))}
            </select>
            <input className="w-28 rounded-md border bg-background p-2 text-sm tabular" placeholder="لتر" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} />
            <button
              disabled={!oilType || !liters || addOil.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              onClick={() => { addOil.mutate({ oil: oilType, liters: litersNum, odo: w.odometer_at_open ?? undefined }); setLiters(""); }}
            >
              تسجيل
            </button>
          </div>
          {flagged && <p className="mt-2 text-xs text-amber-600">⚠︎ الكمية خارج النطاق المعتاد (34–36 لتر) — ستُسجَّل مع تنبيه</p>}
        </div>
      )}

      {w.status === "open" && (
        <button
          onClick={() => close.mutate()}
          disabled={close.isPending}
          className="w-full rounded-lg border-2 border-emerald-500 py-3 font-semibold text-emerald-600 hover:bg-emerald-500/10"
        >
          إقفال أمر الشغل
        </button>
      )}
    </div>
  );
}
