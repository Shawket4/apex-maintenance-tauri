import { useEffect } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowDownLeft, ArrowUpRight, CloudOff } from "lucide-react";

import type { StockMovementRow } from "@/shared/api/client";
import { useStockMovements, useStockMovementsRefresh } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { dayjs, fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { EmptyState, ListCard, PageShell } from "@/widgets/layout/PageShell";
import { Skeleton } from "@/shared/ui/skeleton";

const KINDS = ["all", "tire", "oil"] as const;
const RANGES = ["7", "30", "90", "all"] as const;

export const Route = createFileRoute("/_app/stock/movements")({
  // Filter + range live in the URL so back-navigation restores them.
  validateSearch: (s: Record<string, unknown>): { kind?: "tire" | "oil"; range?: string } => ({
    ...(s.kind === "tire" || s.kind === "oil" ? { kind: s.kind } : {}),
    ...(typeof s.range === "string" && (RANGES as readonly string[]).includes(s.range) && s.range !== "30"
      ? { range: s.range }
      : {}),
  }),
  component: StockMovements,
});

/** The stock in/out ledger for oil and tires — a top-level Stock screen.
 * Online read (movements live server-side), so it shows a "connection needed"
 * state when offline. Filter by type, pick a time range, page through. */
function StockMovements() {
  const { t } = useTranslation();
  const { kind, range = "30" } = Route.useSearch();
  const navigate = Route.useNavigate();

  // The time range → an inclusive `from` date (YYYY-MM-DD); "all" = no bound.
  const from =
    range === "all" ? undefined : dayjs().subtract(Number(range), "day").format("YYYY-MM-DD");
  const movements = useStockMovements(kind, from);
  const rows = movements.data?.pages.flat() ?? [];

  // Reads are LOCAL (offline-safe); refresh the mirror opportunistically on
  // open. Offline it fails silently and the last-synced data stays.
  const refresh = useStockMovementsRefresh();
  useEffect(() => {
    refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Honest "this is local data, not fresh" hint when the refresh couldn't reach
  // the server but we still have something to show.
  const stale = refresh.isError && rows.length > 0;

  const setKind = (k: (typeof KINDS)[number]) =>
    void navigate({ search: (p) => ({ ...p, kind: k === "all" ? undefined : k }), replace: true });
  const setRange = (r: (typeof RANGES)[number]) =>
    void navigate({ search: (p) => ({ ...p, range: r === "30" ? undefined : r }), replace: true });

  return (
    <PageShell title={t("movements.title")} subtitle={t("movements.subtitle")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ChipRow>
          {KINDS.map((k) => (
            <Chip key={k} active={(kind ?? "all") === k} onClick={() => setKind(k)}>
              {t(`movements.filter.${k}`)}
            </Chip>
          ))}
        </ChipRow>
        <span className="h-5 w-px bg-border" />
        <ChipRow>
          {RANGES.map((r) => (
            <Chip key={r} active={range === r} onClick={() => setRange(r)}>
              {t(`movements.range.${r}`)}
            </Chip>
          ))}
        </ChipRow>
        {stale && (
          <span className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <CloudOff className="h-3.5 w-3.5" />
            {t("movements.localData")}
          </span>
        )}
      </div>

      {movements.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState className="flex flex-col items-center gap-2 p-10">
          {refresh.isError && <CloudOff className="h-6 w-6 text-muted-foreground" />}
          {refresh.isError ? t("movements.offlineEmpty") : t("movements.empty")}
        </EmptyState>
      ) : (
        <>
          <ListCard>
            {rows.map((m) => (
              <MovementRow key={m.id} m={m} />
            ))}
          </ListCard>
          {movements.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={movements.isFetchingNextPage}
                onClick={() => void movements.fetchNextPage()}
              >
                {t("movements.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm transition",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
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
