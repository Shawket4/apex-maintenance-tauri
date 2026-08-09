import { Link, createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CloudOff } from "lucide-react";

import type { StockMovementRow } from "@/shared/api/client";
import { useStockMovements } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { EmptyState, ListCard, PageShell } from "@/widgets/layout/PageShell";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/stock/movements")({
  // Filter lives in the URL so back-navigation restores it.
  validateSearch: (s: Record<string, unknown>): { kind?: "tire" | "oil" } =>
    s.kind === "tire" || s.kind === "oil" ? { kind: s.kind } : {},
  component: StockMovements,
});

const FILTERS = ["all", "tire", "oil"] as const;

/** The stock in/out ledger for oil and tires. Online read — movements live
 * server-side, so this shows a "connection needed" state when offline. */
function StockMovements() {
  const { t } = useTranslation();
  const { kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  const movements = useStockMovements(kind);

  const setFilter = (f: (typeof FILTERS)[number]) =>
    void navigate({ search: f === "all" ? {} : { kind: f }, replace: true });

  return (
    <PageShell title={t("movements.title")}>
      <BackLink />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition",
              (kind ?? "all") === f
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-accent",
            )}
          >
            {t(`movements.filter.${f}`)}
          </button>
        ))}
      </div>

      {movements.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : movements.isError ? (
        <EmptyState className="flex flex-col items-center gap-2 p-10">
          <CloudOff className="h-6 w-6 text-muted-foreground" />
          {t("movements.offline")}
        </EmptyState>
      ) : (movements.data ?? []).length === 0 ? (
        <EmptyState className="p-10">{t("movements.empty")}</EmptyState>
      ) : (
        <ListCard>
          {(movements.data ?? []).map((m) => (
            <MovementRow key={m.id} m={m} />
          ))}
        </ListCard>
      )}
    </PageShell>
  );
}

function MovementRow({ m }: { m: StockMovementRow }) {
  const { t, i18n } = useTranslation();
  const isIn = m.kind.endsWith("_credit");
  const isOil = m.kind.startsWith("oil");

  const item = isOil
    ? m.oil_type ?? "—"
    : [m.brand, m.model, m.size].filter(Boolean).join(" ") || "—";
  const amount = isOil
    ? `${fmtNumber(m.liters ?? 0, i18n.language)} ${t("common.liters")}`
    : `${isIn ? "+" : "−"}${fmtNumber(m.qty ?? 0, i18n.language)}`;

  return (
    <div className="flex items-center gap-3.5 px-[18px] py-3">
      <span
        className={cn(
          "flex h-9 w-9 flex-none items-center justify-center rounded-full",
          isIn ? "bg-status-ok-soft text-status-ok" : "bg-status-overdue-soft text-status-overdue",
        )}
      >
        {isIn ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold" dir="ltr">
            {item}
          </span>
          <span
            className={cn(
              "flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold",
              isOil ? "bg-info-soft text-info" : "bg-muted text-muted-foreground",
            )}
          >
            {t(isOil ? "movements.filter.oil" : "movements.filter.tire")}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {isIn ? (
            t("movements.stockIn")
          ) : m.work_order_id && m.plate ? (
            <>
              {t("movements.usedOn")}{" "}
              <Link
                to="/wo/$woId"
                params={{ woId: m.work_order_id }}
                className="font-medium text-primary hover:underline"
                dir="ltr"
              >
                {m.plate}
              </Link>
            </>
          ) : (
            t("movements.stockOut")
          )}
          {" · "}
          <span className="tabular">{fmtCairo(m.created_at, "YYYY/MM/DD HH:mm", i18n.language)}</span>
        </div>
      </div>

      <span
        className={cn(
          "flex-none text-[15px] font-bold tabular",
          isIn ? "text-status-ok" : "text-status-overdue",
        )}
        dir="ltr"
      >
        {amount}
      </span>
    </div>
  );
}

/** History-aware back to wherever this was opened from (usually the Tires
 * screen); falls back there on a cold entry. */
function BackLink() {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const cls = "flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground";
  if (canGoBack) {
    return (
      <button onClick={() => router.history.back()} className={cls}>
        <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("common.back")}
      </button>
    );
  }
  return (
    <Link to="/tires" className={cls}>
      <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("tires.title")}
    </Link>
  );
}
