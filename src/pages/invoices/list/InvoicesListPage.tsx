/**
 * Invoices list page (Phase 2).
 *
 * Architecture mapping:
 *   §4.2 — read-through cache, page-walks the proxy in the background
 *   §4.3 — FTS5-backed search: online tries server first, offline falls
 *          back to local FTS5. The badge in the header tells the user
 *          which one answered.
 *   §13  — virtualized rows, Cairo-time dates, Arabic-Indic numerals
 */

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as reactVirtual from "@tanstack/react-virtual";
import { Cloud, CloudOff, Receipt, Search } from "lucide-react";

import { Input } from "@/shared/ui/input";
import { Card, CardContent } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import {
  useInvoicesAutoRefresh,
  useInvoicesQuery,
  useInvoicesRefresh,
  useInvoicesSearchQuery,
} from "@/shared/api/invoices";
import { CacheFreshnessIndicator } from "@/widgets/CacheFreshnessIndicator/CacheFreshnessIndicator";
import { useDebouncedValue } from "@/shared/lib/useDebouncedValue";
import { env } from "@/shared/config/env";
import { fmtCairo } from "@/shared/lib/time";
import { fmtNumber, fmtKm } from "@/shared/lib/numbers";
import type {
  InvoiceRow,
  SearchSource as SearchSourceKind,
} from "@/entities/invoice/model";
import { cn } from "@/shared/lib/cn";

const PAGE_SIZE = 100;
const ROW_HEIGHT = 64;

export function InvoicesListPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? "ar";

  const [page, setPage] = useState(1);
  const [rawQuery, setRawQuery] = useState("");
  const debouncedQuery = useDebouncedValue(rawQuery.trim(), env.searchDebounceMs);
  const isSearching = debouncedQuery.length > 0;

  const listQ = useInvoicesQuery(page, PAGE_SIZE, !isSearching);
  const searchQ = useInvoicesSearchQuery(debouncedQuery, isSearching);
  const refresh = useInvoicesRefresh();
  useInvoicesAutoRefresh(true);

  const { rows, total, source } = useMemo(() => {
    if (isSearching) {
      return {
        rows: searchQ.data?.rows ?? [],
        total: searchQ.data?.total ?? 0,
        source: searchQ.data?.source ?? null,
      };
    }
    return {
      rows: listQ.data?.rows ?? [],
      total: listQ.data?.total ?? 0,
      source: null as SearchSourceKind | null,
    };
  }, [isSearching, listQ.data, searchQ.data]);

  const isLoading =
    (isSearching && searchQ.isLoading) || (!isSearching && listQ.isLoading);
  const isError =
    (isSearching && searchQ.isError) || (!isSearching && listQ.isError);

  const totalPages = isSearching ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("invoices.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {isSearching
                ? t("invoices.subtitle_search", {
                    matches: fmtNumber(total, locale),
                    query: debouncedQuery,
                  })
                : t("invoices.subtitle", { countStr: fmtNumber(total, locale) })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isSearching && source && <SearchSourceBadge source={source} />}
          <CacheFreshnessIndicator
            cacheName="service_invoices"
            onRefresh={() => refresh.mutate()}
            isRefreshing={refresh.isPending}
          />
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={rawQuery}
                onChange={(e) => {
                  setRawQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={t("invoices.search_placeholder")}
                className="ps-9"
                dir="auto"
              />
            </div>
          </div>

          {isLoading ? (
            <EmptyState message={t("actions.loading")} />
          ) : isError ? (
            <EmptyState message={t("invoices.error")} variant="error" />
          ) : rows.length === 0 ? (
            <EmptyState
              message={
                isSearching
                  ? t("invoices.empty_search", { query: debouncedQuery })
                  : t("invoices.empty_total")
              }
            />
          ) : (
            <InvoicesTable rows={rows} />
          )}

          {!isSearching && total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">
                {t("invoices.pagination", {
                  page: fmtNumber(page, locale),
                  total: fmtNumber(totalPages, locale),
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t("actions.previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t("actions.next")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- *
 * Source badge — tells the user whether the answer came from the
 * server (online) or the local FTS5 index (offline fallback).
 * --------------------------------------------------------------- */

function SearchSourceBadge({ source }: { source: SearchSourceKind }) {
  const { t } = useTranslation();
  const online = source === "online";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        online
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
      title={online ? t("invoices.source.online_hint") : t("invoices.source.offline_hint")}
    >
      {online ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
      <span>{online ? t("invoices.source.online") : t("invoices.source.offline")}</span>
    </span>
  );
}

/* --------------------------------------------------------------- *
 * Virtualized table
 * --------------------------------------------------------------- */

function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? "ar";
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = reactVirtual.useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="max-h-[68vh] overflow-auto">
      <div role="table" className="min-w-[1000px] text-sm" style={{ width: "100%" }}>
        <div role="rowgroup" className="sticky top-0 z-10 bg-card border-b border-border">
          <div
            role="row"
            className="grid grid-cols-[120px_140px_1fr_140px_120px_100px_120px] gap-3 px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
          >
            <div role="columnheader">{t("invoices.col.date")}</div>
            <div role="columnheader">{t("invoices.col.plate")}</div>
            <div role="columnheader">{t("invoices.col.services")}</div>
            <div role="columnheader">{t("invoices.col.driver")}</div>
            <div role="columnheader">{t("invoices.col.region")}</div>
            <div role="columnheader" className="text-end tabular">
              {t("invoices.col.items")}
            </div>
            <div role="columnheader" className="text-end tabular">
              {t("invoices.col.meter")}
            </div>
          </div>
        </div>

        <div
          role="rowgroup"
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const r = rows[vi.index]!;
            return (
              <div
                key={r.id}
                role="row"
                className="absolute inset-x-0 grid grid-cols-[120px_140px_1fr_140px_120px_100px_120px] gap-3 items-center px-4 border-b border-border/50 hover:bg-accent/40 transition-colors"
                style={{
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <div className="tabular text-muted-foreground">
                  {r.date ? fmtCairo(r.date, "YYYY/MM/DD", locale) : "—"}
                </div>
                <div className="font-medium tabular truncate" dir="auto" title={r.plate_number ?? ""}>
                  {r.plate_number ?? "—"}
                </div>
                <div className="truncate" dir="auto" title={r.services_preview ?? ""}>
                  {r.services_preview ?? <span className="text-muted-foreground">—</span>}
                </div>
                <div className="truncate" title={r.driver_name ?? ""}>
                  {r.driver_name ?? <span className="text-muted-foreground">—</span>}
                </div>
                <div className="truncate text-muted-foreground" title={r.operating_region ?? ""}>
                  {r.operating_region ?? "—"}
                </div>
                <div className="text-end tabular">{fmtNumber(r.item_count, locale)}</div>
                <div className="text-end tabular text-muted-foreground">
                  {fmtKm(r.meter_reading, locale)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  message,
  variant = "default",
}: {
  message: string;
  variant?: "default" | "error";
}) {
  return (
    <div
      className={cn(
        "p-12 text-center text-sm",
        variant === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {message}
    </div>
  );
}
