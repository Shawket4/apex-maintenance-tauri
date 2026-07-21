import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { maintApi } from "@/shared/api/maint";
import { appErrorMessage } from "@/shared/api/tauri";
import { toast } from "@/shared/lib/toast-store";

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">الإعدادات والجدولة</h1>
      <ClassTagging />
      <ServicePlans />
    </div>
  );
}

function ClassTagging() {
  const qc = useQueryClient();
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => maintApi.vehicles() });
  const classes = useQuery({ queryKey: ["vehicle-classes"], queryFn: () => maintApi.vehicleClasses() });
  const assign = useMutation({
    mutationFn: (v: { id: number; cls: string }) => maintApi.assignClass(v.id, v.cls),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["due"] });
      toast.success("تم تصنيف العربية");
    },
    onError: (e) => toast.error(appErrorMessage(e)),
  });

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">تصنيف العربيات</h2>
      <p className="mb-3 text-xs text-muted-foreground">التصنيف بيحدد خطة الصيانة اللي تنطبق على العربية.</p>
      <div className="space-y-2">
        {(vehicles.data ?? []).map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
            <span className="font-medium">{v.car_no_plate}</span>
            <select
              className="rounded-md border bg-background p-2 text-sm"
              value={v.class_id ?? ""}
              onChange={(e) => assign.mutate({ id: v.id, cls: e.target.value })}
            >
              <option value="">— بدون تصنيف —</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name_ar}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}

function ServicePlans() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["service-plans"], queryFn: () => maintApi.servicePlans() });
  const classes = useQuery({ queryKey: ["vehicle-classes"], queryFn: () => maintApi.vehicleClasses() });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => maintApi.categories() });

  const [classId, setClassId] = useState("");
  const [catId, setCatId] = useState("");
  const [trigger, setTrigger] = useState<"mileage" | "time">("mileage");
  const [interval, setInterval] = useState("");

  const upsert = useMutation({
    mutationFn: () =>
      maintApi.upsertPlan({
        class_id: classId,
        category_id: catId,
        trigger_type: trigger,
        interval_km: trigger === "mileage" ? Number(interval) : undefined,
        interval_days: trigger === "time" ? Number(interval) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-plans"] });
      qc.invalidateQueries({ queryKey: ["due"] });
      setInterval("");
      toast.success("تم حفظ الخطة");
    },
    onError: (e) => toast.error(appErrorMessage(e)),
  });

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">خطط الصيانة (لكل تصنيف)</h2>
      <div className="mb-3 space-y-2">
        {(plans.data ?? []).map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm tabular">
            <span>{p.class_id} · {p.category_id}</span>
            <span className="text-muted-foreground">
              {p.trigger_type === "mileage" ? `كل ${p.interval_km?.toLocaleString()} كم` : `كل ${p.interval_days} يوم`}
            </span>
          </div>
        ))}
        {(plans.data?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">لا توجد خطط بعد</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-4">
        <Field label="التصنيف">
          <select className="rounded-md border bg-background p-2 text-sm" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">—</option>
            {(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
          </select>
        </Field>
        <Field label="الصنف">
          <select className="rounded-md border bg-background p-2 text-sm" value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">—</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
          </select>
        </Field>
        <Field label="النوع">
          <select className="rounded-md border bg-background p-2 text-sm" value={trigger} onChange={(e) => setTrigger(e.target.value as "mileage" | "time")}>
            <option value="mileage">كيلومترات</option>
            <option value="time">أيام</option>
          </select>
        </Field>
        <Field label={trigger === "mileage" ? "كل (كم)" : "كل (يوم)"}>
          <input className="w-28 rounded-md border bg-background p-2 text-sm tabular" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />
        </Field>
        <button
          disabled={!classId || !catId || !interval || upsert.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          onClick={() => upsert.mutate()}
        >
          حفظ الخطة
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
