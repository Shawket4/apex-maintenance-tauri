import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { maintApi } from "@/shared/api/maint";

const TIRE_STATUS: Record<string, string> = {
  mounted: "مركّب",
  in_stock_used: "مخزن (مستعمل)",
  in_repair: "تصليح",
  retreading: "توسيع",
  scrapped: "خردة",
};

export function InventoryPage() {
  const [tab, setTab] = useState<"tires" | "stock">("stock");
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">الكاوتش والمخزن</h1>
      <div className="mb-6 flex gap-2">
        <Tab active={tab === "stock"} onClick={() => setTab("stock")}>المخزن</Tab>
        <Tab active={tab === "tires"} onClick={() => setTab("tires")}>الكاوتش (أصول)</Tab>
      </div>
      {tab === "stock" ? <StockView /> : <TiresView />}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm font-medium ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}
    >
      {children}
    </button>
  );
}

function StockView() {
  const tires = useQuery({ queryKey: ["stock-tires"], queryFn: () => maintApi.stockTires() });
  const oil = useQuery({ queryKey: ["stock-oil"], queryFn: () => maintApi.stockOil() });
  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <h2 className="mb-2 text-sm font-semibold">كاوتش جديد (شحنات)</h2>
        <div className="space-y-2">
          {(tires.data ?? []).map((t, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <span>{t.brand} {t.model} <span className="text-muted-foreground">{t.size}</span></span>
              <span className="tabular font-semibold">{t.on_hand_qty}</span>
            </div>
          ))}
          {(tires.data?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">المخزن فارغ</p>}
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold">الزيوت (لتر)</h2>
        <div className="space-y-2">
          {(oil.data ?? []).map((o, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border bg-card p-3">
              <span>{o.oil_type}</span>
              <span className="tabular font-semibold">{o.liters_on_hand}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TiresView() {
  const tires = useQuery({ queryKey: ["tires-all"], queryFn: () => maintApi.tires() });
  const rows = tires.data ?? [];
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد كاوتش مسجّل بعد — يظهر الكاوتش هنا بعد أول تركيب.</p>}
      {rows.map((t) => (
        <div key={t.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
          <div>
            <div className="font-semibold">{t.brand} {t.model ?? ""}</div>
            <div className="text-xs text-muted-foreground tabular">{t.dot_code ?? "بدون DOT"} · {t.total_km.toLocaleString()} كم</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {t.mounted_position_code && <span className="rounded bg-muted px-2 py-0.5 text-xs tabular">{t.mounted_position_code}</span>}
            <span className="rounded-full bg-accent px-2 py-1 text-xs">{TIRE_STATUS[t.status] ?? t.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
