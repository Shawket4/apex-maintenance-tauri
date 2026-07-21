import { useMemo, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Gauge, Plus, ClipboardList, History, CircleDot, CalendarClock } from "lucide-react";
import { maintApi, STATUS_COLORS, type ServiceEvent } from "@/shared/api/maint";
import { appErrorMessage } from "@/shared/api/tauri";
import { toast } from "@/shared/lib/toast-store";
import { fmtNumber } from "@/shared/lib/numbers";
import { dayjs } from "@/shared/lib/time";
import { TruckDiagram } from "@/widgets/TruckDiagram/TruckDiagram";
import { generateChassis } from "@/shared/lib/chassis-gen";
import { InvoiceReceipt } from "@/widgets/InvoiceReceipt/InvoiceReceipt";

type Tab = "work" | "service" | "diagram" | "due";

const TABS: { id: Tab; label: string; icon: typeof ClipboardList }[] = [
  { id: "work", label: "أوامر الشغل", icon: ClipboardList },
  { id: "service", label: "سجل الخدمة", icon: History },
  { id: "diagram", label: "الكاوتش", icon: CircleDot },
  { id: "due", label: "المستحق", icon: CalendarClock },
];

export function TruckDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const vid = Number(id);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("work");

  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => maintApi.vehicles() });
  const truck = (vehicles.data ?? []).find((v) => v.id === vid);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <button onClick={() => navigate({ to: "/" })} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="h-4 w-4" /> كل العربيات
      </button>

      <div className="mb-6 rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-6">
        <div className="text-2xl font-bold tracking-wide">{truck?.car_no_plate ?? `عربية #${vid}`}</div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {truck?.class_id && <span className="rounded bg-muted px-2 py-0.5">{truck.class_id}</span>}
          <span className="flex items-center gap-1 tabular">
            <Gauge className="h-4 w-4" />
            {truck?.last_fuel_odometer ? `${fmtNumber(truck.last_fuel_odometer)} كم` : "— كم"}
          </span>
        </div>
      </div>

      <div className="mb-6 flex gap-1 rounded-xl border bg-card p-1">
        {TABS.map(({ id: t, label, icon: Icon }) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "work" && <WorkTab vid={vid} />}
      {tab === "service" && <ServiceTab vid={vid} />}
      {tab === "diagram" && <DiagramTab vid={vid} />}
      {tab === "due" && <DueTab vid={vid} />}
    </div>
  );
}

function WorkTab({ vid }: { vid: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wos = useQuery({ queryKey: ["work-orders", "veh", vid], queryFn: () => maintApi.workOrders(undefined, vid) });
  const open = useMutation({
    mutationFn: () => maintApi.openWorkOrder(vid, "صيانة", undefined),
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      navigate({ to: "/wo/$id", params: { id } });
    },
    onError: (e) => toast.error(appErrorMessage(e)),
  });
  const list = wos.data ?? [];
  return (
    <div>
      <button
        onClick={() => open.mutate()}
        className="mb-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        <Plus className="h-4 w-4" /> أمر شغل جديد
      </button>
      <div className="space-y-2">
        {list.length === 0 && <Empty>لا توجد أوامر شغل لهذه العربية</Empty>}
        {list.map((w) => (
          <button
            key={w.work_order.id}
            onClick={() => navigate({ to: "/wo/$id", params: { id: w.work_order.id } })}
            className="flex w-full items-center justify-between rounded-xl border bg-card p-4 text-start hover:bg-accent"
          >
            <div>
              <div className="font-semibold">{w.work_order.title || "أمر شغل"}</div>
              <div className="text-xs text-muted-foreground tabular">{dayjs(w.work_order.opened_at).format("D MMM YYYY")}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-1 text-xs tabular">{fmtNumber(w.task_count)} بند</span>
              <span className={`rounded-full px-2 py-1 text-xs ${w.work_order.status === "open" ? "bg-emerald-500/15 text-emerald-600" : "bg-muted"}`}>
                {w.work_order.status === "open" ? "مفتوح" : "مقفول"}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ServiceTab({ vid }: { vid: number }) {
  const events = useQuery({ queryKey: ["service-events", vid], queryFn: () => maintApi.serviceEvents(vid) });
  const [openId, setOpenId] = useState<number | null>(null);
  if (events.isLoading) return <Loading />;
  if (events.isError) return <Empty>سجل الخدمة غير متاح (تأكد من اتصال Falcon)</Empty>;
  const list = events.data ?? [];
  if (list.length === 0) return <Empty>لا يوجد سجل خدمة لهذه العربية</Empty>;

  const active = openId != null ? list.find((e) => e.id === openId) : null;
  if (active) {
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="h-4 w-4" /> كل الفواتير
        </button>
        <ServiceReceipt ev={active} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {list.map((ev: ServiceEvent) => (
        <button
          key={ev.id}
          onClick={() => setOpenId(ev.id)}
          className="flex w-full items-center justify-between rounded-xl border bg-card p-4 text-start hover:bg-accent"
        >
          <div>
            <div className="font-semibold tabular">{ev.date ? dayjs(ev.date).format("D MMM YYYY") : "—"}</div>
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {ev.items.map((i) => i.service).slice(0, 3).join(" · ") || "بدون بنود"}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {ev.meter_reading != null && <span className="tabular text-muted-foreground">{fmtNumber(ev.meter_reading)} كم</span>}
            <span className="rounded-full bg-muted px-2 py-1 tabular">{fmtNumber(ev.items.length)} بند</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ServiceReceipt({ ev }: { ev: ServiceEvent }) {
  return (
    <InvoiceReceipt
      title={`فاتورة خدمة #${ev.id}`}
      subtitle="شركة أبيكس للنقل"
      primaryHeader="الخدمة"
      secondaryHeader="ملاحظات"
      stats={[
        { label: "التاريخ", value: ev.date ? dayjs(ev.date).format("D MMM YYYY") : "—", icon: CalendarClock, tone: "primary" },
        { label: "العداد", value: ev.meter_reading != null ? `${fmtNumber(ev.meter_reading)} كم` : "—", icon: Gauge, tone: "success" },
        { label: "السائق", value: ev.driver_name || "—", icon: History },
        ...(ev.supervisor ? [{ label: "المشرف", value: ev.supervisor, icon: History, tone: "warning" as const }] : []),
        ...(ev.operating_region ? [{ label: "المنطقة", value: ev.operating_region, icon: History }] : []),
      ]}
      items={ev.items.map((it) => ({ primary: it.service, secondary: it.notes }))}
    />
  );
}

function DiagramTab({ vid: _vid }: { vid: number }) {
  // Chassis derived deterministically per truck until a persisted chassis + mount
  // flow lands (M2 follow-up).
  const { axles, positions } = useMemo(
    () => generateChassis({ driveAxles: 2, trailerAxles: 3, spares: 2 }),
    [],
  );
  const [selected, setSelected] = useState<{ position_code: string } | null>(null);
  return (
    <div className="relative h-[460px] overflow-hidden rounded-2xl border bg-card">
      <TruckDiagram axles={axles} positions={positions} selectedId={(selected as any)?.id ?? null} onSelect={setSelected as any} />
      {selected && (
        <div className="absolute bottom-4 end-4 rounded-xl border bg-card/95 px-4 py-3 text-sm shadow-lg backdrop-blur">
          <div className="text-xs text-muted-foreground">الموضع</div>
          <div className="text-lg font-bold tabular">{selected.position_code}</div>
        </div>
      )}
    </div>
  );
}

function DueTab({ vid }: { vid: number }) {
  const due = useQuery({ queryKey: ["due", vid], queryFn: () => maintApi.due(vid) });
  if (due.isLoading) return <Loading />;
  const rows = due.data ?? [];
  if (rows.length === 0) return <Empty>لا توجد بيانات مستحقة (صنّف العربية وأضِف خطة صيانة)</Empty>;
  const LABEL: Record<string, string> = { overdue: "متأخر", never_done: "لم يتم", due_soon: "قريب", ok: "تمام" };
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${STATUS_COLORS[r.status]}`} />
            <div>
              <div className="font-semibold">{r.category_name_ar}</div>
              <div className="text-xs text-muted-foreground">{LABEL[r.status]}</div>
            </div>
          </div>
          <div className="text-sm tabular text-muted-foreground">
            {r.next_due_km ? `مستحق عند ${fmtNumber(r.next_due_km)}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">{children}</div>;
}
function Loading() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl border bg-card" />
      ))}
    </div>
  );
}
