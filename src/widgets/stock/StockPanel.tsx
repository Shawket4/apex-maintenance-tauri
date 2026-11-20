import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CloudOff, Loader2, PackagePlus, RefreshCw } from "lucide-react";

import { commands, isOffline, unwrap, type StockOilLine, type StockTireLine } from "@/shared/api/client";
import { useAuth } from "@/shared/api/auth";
import { useStock } from "@/shared/api/queries";
import { errorText, notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtLiters, fmtNumber } from "@/shared/lib/numbers";
import { fmtAgo, fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";

import { ReceiveStockDialog } from "./ReceiveStockDialog";

/** Who may receive stock (the server enforces the same level). */
const RECEIVE_PERMISSION = 4;

type Level = "negative" | "empty" | "low" | "ok";

function levelOf(amount: number, low: boolean): Level {
  if (amount < 0) return "negative";
  if (amount === 0) return "empty";
  return low ? "low" : "ok";
}

/** New tires and oil on hand, with a refresh and (for whoever is allowed)
 * stock receiving. The numbers are the last count read from the fleet system
 * minus the work recorded on this device that has not been sent yet. */
export function StockPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const { user } = useAuth();
  const canReceive = (user?.permission ?? 0) >= RECEIVE_PERMISSION;
  const stock = useStock();
  const [receiving, setReceiving] = useState(false);

  const refresh = useMutation({
    mutationFn: () => unwrap(commands.stockRefresh()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
    },
  });

  // One quiet refresh when the screen opens, so a shipment received on another
  // device shows up. ONCE: the old version re-fired after every answer for as
  // long as the stock was empty.
  const autoRefreshed = useRef(false);
  const { mutate: refreshMutate } = refresh;
  useEffect(() => {
    if (autoRefreshed.current) return;
    autoRefreshed.current = true;
    refreshMutate();
  }, [refreshMutate]);

  const refreshNow = () =>
    refresh.mutate(undefined, {
      onSuccess: () => notifySuccess(t("stock.refreshed")),
      onError: notifyError,
    });

  const refreshButton = (
    <Button variant="outline" onClick={refreshNow} disabled={refresh.isPending}>
      {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {t("stock.refresh")}
    </Button>
  );

  return (
    <section aria-labelledby="stock-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="stock-heading" className="text-base font-bold">
          {t("stock.title")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {refreshButton}
          {canReceive && (
            <Button onClick={() => setReceiving(true)} disabled={!stock.data}>
              <PackagePlus />
              {t("stock.receive.open")}
            </Button>
          )}
        </div>
      </div>

      <QueryState query={stock} skeleton={<Skeleton className="h-28 w-full rounded-xl" />}>
        {(data) => {
          const stamps = [...data.tires, ...data.oil].map((l) => l.fetched_at).filter((s): s is string => !!s);
          const fetchedAt = stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null;
          const hasPending =
            data.tires.some((l) => l.pending_debits > 0) || data.oil.some((l) => l.pending_liters > 0);
          const nothing = data.tires.length === 0 && data.oil.length === 0;

          return (
            <div className="space-y-4">
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  {fetchedAt
                    ? t("stock.updatedAt", {
                        at: fmtCairo(fetchedAt, "YYYY/MM/DD HH:mm", lang),
                        ago: fmtAgo(fetchedAt, lang),
                      })
                    : refresh.isSuccess
                      ? t("stock.updatedJustNow")
                      : t("stock.neverUpdated")}
                </p>
                <p>{hasPending ? t("stock.pendingExplainSome") : t("stock.pendingExplain")}</p>
                {refresh.isError && (
                  <p className="flex items-start gap-1.5 text-status-due_soon">
                    {isOffline(refresh.error) ? (
                      <CloudOff className="mt-0.5 h-4 w-4 flex-none" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                    )}
                    <span>
                      {isOffline(refresh.error)
                        ? t("stock.refreshOffline")
                        : t("stock.refreshFailed", { why: errorText(refresh.error) })}
                    </span>
                  </p>
                )}
                {!canReceive && <p>{t("stock.receive.notAllowed")}</p>}
              </div>

              {nothing ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <p>{canReceive ? t("stock.emptyCanReceive") : t("stock.empty")}</p>
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t("stock.tiresTitle")}</h3>
                    {data.tires.length === 0 ? (
                      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                        {t("stock.noTires")}
                      </p>
                    ) : (
                      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {data.tires.map((line) => (
                          <TireLine key={line.id} line={line} />
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t("stock.oilTitle")}</h3>
                    {data.oil.length === 0 ? (
                      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                        {t("stock.noOil")}
                      </p>
                    ) : (
                      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {data.oil.map((line) => (
                          <OilLine key={line.id} line={line} />
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              <p className="text-sm">
                {t("stock.usedPool")}{" "}
                <span className="font-bold tabular">{fmtNumber(data.used_pool_count, lang)}</span>
                <span className="text-muted-foreground"> {t("stock.usedPoolHint")}</span>
              </p>

              {receiving && (
                <ReceiveStockDialog open onOpenChange={setReceiving} stock={data} />
              )}
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

const LEVEL_BOX: Record<Level, string> = {
  negative: "border-status-overdue/50 bg-status-overdue-soft",
  empty: "border-status-overdue/40",
  low: "border-status-due_soon/50",
  ok: "",
};
const LEVEL_TEXT: Record<Level, string> = {
  negative: "text-status-overdue",
  empty: "text-status-overdue",
  low: "text-status-due_soon",
  ok: "",
};

function LevelNote({ level, negativeKey }: { level: Level; negativeKey: string }) {
  const { t } = useTranslation();
  if (level === "ok") return null;
  return (
    <p className={cn("mt-2 flex items-start gap-1.5 text-sm font-medium", LEVEL_TEXT[level])}>
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
      <span>{level === "negative" ? t(negativeKey) : t(`stock.level.${level}`)}</span>
    </p>
  );
}

function TireLine({ line }: { line: StockTireLine }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const level = levelOf(line.projected_qty, line.low_stock);
  return (
    <li className={cn("rounded-xl border bg-card p-4 shadow-sm", LEVEL_BOX[level])}>
      <div className="font-semibold">
        <bdi>{[line.brand, line.model].filter(Boolean).join(" ")}</bdi>
      </div>
      {line.size && (
        <div className="text-sm text-muted-foreground">
          <bdi dir="ltr">{line.size}</bdi>
        </div>
      )}
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-2xl font-bold tabular", LEVEL_TEXT[level])} dir="ltr">
          {fmtNumber(line.projected_qty, lang)}
        </span>
        <span className="text-sm text-muted-foreground">{t("stock.tiresAvailable")}</span>
      </div>
      {line.pending_debits > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("stock.tiresBreakdown", {
            counted: fmtNumber(line.snapshot_qty, lang),
            pending: fmtNumber(line.pending_debits, lang),
          })}
        </p>
      )}
      <LevelNote level={level} negativeKey="stock.level.negativeTires" />
    </li>
  );
}

function OilLine({ line }: { line: StockOilLine }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const level = levelOf(line.projected_liters, line.low_stock);
  return (
    <li className={cn("rounded-xl border bg-card p-4 shadow-sm", LEVEL_BOX[level])}>
      <div className="font-semibold">
        <bdi>{line.oil_type}</bdi>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("text-2xl font-bold tabular", LEVEL_TEXT[level])}>
          <bdi>{fmtLiters(line.projected_liters, lang)}</bdi>
        </span>
        <span className="text-sm text-muted-foreground">{t("stock.oilAvailable")}</span>
      </div>
      {line.pending_liters > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("stock.oilBreakdown", {
            counted: fmtLiters(line.snapshot_liters, lang),
            pending: fmtLiters(line.pending_liters, lang),
          })}
        </p>
      )}
      <LevelNote level={level} negativeKey="stock.level.negativeOil" />
    </li>
  );
}
