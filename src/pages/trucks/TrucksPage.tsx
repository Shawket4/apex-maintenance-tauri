import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search, Truck, Gauge, Wrench } from "lucide-react";
import { maintApi } from "@/shared/api/maint";
import { fmtNumber } from "@/shared/lib/numbers";

const CLASS_LABEL: Record<string, string> = {
  tractor: "جرار",
  tanker_trailer: "تريلا صهريج",
};

export function TrucksPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => maintApi.vehicles() });
  const openWos = useQuery({ queryKey: ["work-orders", "open"], queryFn: () => maintApi.workOrders("open") });

  const openByVehicle = useMemo(() => {
    const m = new Map<number, number>();
    for (const w of openWos.data ?? []) m.set(w.work_order.vehicle_id, (m.get(w.work_order.vehicle_id) ?? 0) + 1);
    return m;
  }, [openWos.data]);

  const list = (vehicles.data ?? []).filter((v) => !q || v.car_no_plate.includes(q));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">العربيات</h1>
          <p className="text-sm text-muted-foreground">{fmtNumber(list.length)} عربية</p>
        </div>
        <div className="relative w-72 max-w-full">
          <Search className="pointer-events-none absolute inset-inline-start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث برقم اللوحة…"
            className="w-full rounded-xl border bg-card py-2.5 ps-10 pe-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {vehicles.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border bg-card" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">لا توجد عربيات</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((v) => {
            const open = openByVehicle.get(v.id) ?? 0;
            return (
              <button
                key={v.id}
                onClick={() => navigate({ to: "/trucks/$id", params: { id: String(v.id) } })}
                className="group flex flex-col rounded-2xl border bg-card p-5 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Truck className="h-6 w-6" />
                  </div>
                  {open > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                      <Wrench className="h-3 w-3" /> {fmtNumber(open)} شغل
                    </span>
                  )}
                </div>
                <div className="text-lg font-bold tracking-wide">{v.car_no_plate}</div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  {v.class_id && <span className="rounded bg-muted px-2 py-0.5">{CLASS_LABEL[v.class_id] ?? v.class_id}</span>}
                  {v.car_type && !v.class_id && <span className="rounded bg-muted px-2 py-0.5">{v.car_type}</span>}
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-sm tabular text-muted-foreground">
                  <Gauge className="h-4 w-4" />
                  {v.last_fuel_odometer ? `${fmtNumber(v.last_fuel_odometer)} كم` : "— كم"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
