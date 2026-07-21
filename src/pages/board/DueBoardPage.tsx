import { useQuery } from "@tanstack/react-query";
import { maintApi, STATUS_COLORS } from "@/shared/api/maint";

const LABELS: Record<string, string> = {
  overdue: "متأخر",
  never_done: "لم يتم",
  due_soon: "قريب",
  ok: "تمام",
};

export function DueBoardPage() {
  const due = useQuery({ queryKey: ["due"], queryFn: () => maintApi.due() });
  const rows = due.data ?? [];
  const groups = ["overdue", "never_done", "due_soon", "ok"] as const;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold">المستحق للصيانة</h1>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          لا توجد بيانات — أضِف خطط صيانة (service_plans) وصنّف العربيات لتظهر هنا.
        </p>
      )}
      {groups.map((g) => {
        const gr = rows.filter((r) => r.status === g);
        if (gr.length === 0) return null;
        return (
          <div key={g} className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className={`h-3 w-3 rounded-full ${STATUS_COLORS[g]}`} /> {LABELS[g]} ({gr.length})
            </h2>
            <div className="space-y-2">
              {gr.map((r, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border bg-card p-4">
                  <div>
                    <div className="font-semibold">{r.category_name_ar}</div>
                    <div className="text-sm text-muted-foreground tabular">
                      عربية #{r.vehicle_id} · عداد {r.current_odometer?.toLocaleString() ?? "—"}
                    </div>
                  </div>
                  <div className="text-sm tabular text-muted-foreground">
                    {r.next_due_km ? `مستحق عند ${r.next_due_km.toLocaleString()}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
