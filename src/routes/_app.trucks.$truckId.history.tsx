import { useMemo, useState } from "react";
import { Link, createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, FileSpreadsheet, Loader2, ReceiptText, RefreshCw, Search, Wrench, X } from "lucide-react";

import { commands, unwrap, type ExcelExportConfig, type InvoiceRow, type WoListRow } from "@/shared/api/client";
import { useInvoice, useTruck, useWos } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtNumber, toAsciiDigits } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ErrorState, QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/trucks/$truckId/history")({
  // The open invoice lives in the URL: Back closes it instead of leaving the
  // truck, and other screens can link straight to an invoice (?inv=123).
  validateSearch: (s: Record<string, unknown>): { inv?: number } => {
    const n = Number(s.inv);
    return Number.isInteger(n) && n > 0 ? { inv: n } : {};
  },
  component: TruckHistory,
});

const PAGE = 50;
/** The Excel writer runs on the computer's file system; the Android save
 * dialog hands back a document link it cannot write to. */
const CAN_EXPORT = typeof navigator !== "undefined" && !/Android/i.test(navigator.userAgent);

type TimelineItem =
  | { kind: "wo"; key: string; date: string | null; wo: WoListRow; text: string }
  | { kind: "invoice"; key: string; date: string | null; inv: InvoiceRow; text: string };

const fold = (s: string) => toAsciiDigits(s).toLowerCase();

function woItem(w: WoListRow): TimelineItem {
  const date = w.closed_at ?? w.opened_at;
  return {
    kind: "wo",
    key: `wo-${w.id}`,
    date,
    wo: w,
    text: fold([w.title, w.notes, w.odometer_at_open, fmtCairo(date, "YYYY/MM/DD", "en")].filter(Boolean).join(" ")),
  };
}

function invoiceItem(inv: InvoiceRow): TimelineItem {
  return {
    kind: "invoice",
    key: `inv-${inv.id}`,
    date: inv.date,
    inv,
    text: fold(
      [
        inv.services_preview,
        inv.driver_name,
        inv.supervisor,
        inv.operating_region,
        inv.meter_reading,
        fmtCairo(inv.date, "YYYY/MM/DD", "en"),
      ]
        .filter(Boolean)
        .join(" "),
    ),
  };
}

const byDateDesc = (x: TimelineItem, y: TimelineItem) => (y.date ?? "").localeCompare(x.date ?? "");

/** One story of the truck from two systems: workshop work orders (kept on
 * this device) and the fleet system's service invoices (a copy kept on this
 * device, loaded a page at a time), sorted together. */
function TruckHistory() {
  const { inv } = Route.useSearch();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  if (inv != null) return <InvoiceView id={inv} truckId={truckId} />;
  return <Timeline vid={vid} truckId={truckId} />;
}

function Timeline({ vid, truckId }: { vid: number; truckId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const truck = useTruck(vid);
  const wos = useWos("closed", vid);
  const invoices = useInfiniteQuery({
    queryKey: ["invoices", vid, "paged"],
    queryFn: ({ pageParam }) =>
      unwrap(commands.invoicesList({ page: pageParam, limit: PAGE, car_id: vid })),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return last.rows.length > 0 && loaded < last.total ? all.length + 1 : undefined;
    },
  });
  const [filter, setFilter] = useState("");

  const refresh = useMutation({
    mutationFn: () => unwrap(commands.invoicesRefresh()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["invoice"] });
      notifySuccess(t("truck.history.refreshed"));
    },
    onError: notifyError,
  });

  const loadedInvoices = useMemo(
    () => (invoices.data?.pages ?? []).flatMap((p) => p.rows),
    [invoices.data],
  );
  const totalInvoices = invoices.data?.pages[0]?.total ?? 0;
  const hasMore = invoices.hasNextPage;

  const timeline = useMemo<TimelineItem[]>(() => {
    const invItems = loadedInvoices.map(invoiceItem);
    let woItems = (wos.data ?? []).map(woItem);
    // While older invoices are still unloaded, a work order older than the
    // oldest loaded invoice would be shown out of place: hold it back until
    // its neighbours are loaded.
    if (hasMore && invItems.length > 0) {
      const oldest = invItems[invItems.length - 1].date ?? "";
      woItems = woItems.filter((w) => (w.date ?? "") >= oldest);
    }
    return [...woItems, ...invItems].sort(byDateDesc);
  }, [wos.data, loadedInvoices, hasMore]);

  const needle = fold(filter.trim());
  const shown = needle ? timeline.filter((i) => i.text.includes(needle)) : timeline;

  const exportExcel = useMutation({
    mutationFn: async () => {
      // Everything, not only the pages on screen.
      const all: InvoiceRow[] = [];
      for (let page = 1; ; page++) {
        const res = await unwrap(commands.invoicesList({ page, limit: 500, car_id: vid }));
        all.push(...res.rows);
        if (res.rows.length === 0 || all.length >= res.total) break;
      }
      let items = [...(wos.data ?? []).map(woItem), ...all.map(invoiceItem)].sort(byDateDesc);
      if (needle) items = items.filter((i) => i.text.includes(needle));
      const plate = truck.data?.plate ?? truckId;
      const config: ExcelExportConfig = {
        filename: `${t("truck.history.exportFile")}-${plate.replace(/\s+/g, "")}`,
        meta: null,
        creator: null,
        sheets: [
          {
            name: t("truck.tabs.history"),
            title: t("truck.history.exportTitle", { plate }),
            subtitle: needle ? t("truck.history.exportFiltered", { q: filter.trim() }) : null,
            isRtl: lang.startsWith("ar"),
            stats: null,
            totals: null,
            columns: [
              { key: "date", header: t("truck.history.colDate"), type: null, width: 14, total: null },
              { key: "source", header: t("truck.history.colSource"), type: null, width: 18, total: null },
              { key: "km", header: t("truck.history.colKm"), type: "number", width: 14, total: null },
              { key: "count", header: t("truck.history.colCount"), type: "number", width: 12, total: null },
              { key: "details", header: t("truck.history.colDetails"), type: null, width: 70, total: null },
              { key: "driver", header: t("truck.history.colDriver"), type: null, width: 22, total: null },
            ],
            rows: items.map((i) =>
              i.kind === "wo"
                ? {
                    date: fmtCairo(i.date, "YYYY/MM/DD", "en"),
                    source: t("truck.history.workshop"),
                    km: i.wo.odometer_at_open,
                    count: i.wo.task_count,
                    details: [i.wo.title, i.wo.notes].filter(Boolean).join(" — "),
                    driver: "",
                  }
                : {
                    date: fmtCairo(i.date, "YYYY/MM/DD", "en"),
                    source: t("truck.history.falcon"),
                    km: i.inv.meter_reading,
                    count: i.inv.item_count,
                    details: i.inv.services_preview ?? "",
                    driver: i.inv.driver_name ?? "",
                  },
            ),
          },
        ],
      };
      await unwrap(commands.exportToExcel(config));
    },
    onError: notifyError,
  });

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-md">
        <label htmlFor="history-filter" className="sr-only">
          {t("truck.history.filterLabel")}
        </label>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="history-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("truck.history.filterPlaceholder")}
          className="h-11 ps-9 pe-11"
          dir="auto"
          autoComplete="off"
        />
        {filter && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute end-0.5 top-1/2 -translate-y-1/2"
            aria-label={t("truck.history.clearFilter")}
            onClick={() => setFilter("")}
          >
            <X />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 sm:ms-auto">
        <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
          {refresh.isPending ? t("truck.history.refreshing") : t("truck.history.refresh")}
        </Button>
        {CAN_EXPORT && (
          <Button
            variant="outline"
            onClick={() => exportExcel.mutate()}
            disabled={exportExcel.isPending || wos.isPending || invoices.isPending}
          >
            {exportExcel.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            {t("truck.history.export")}
          </Button>
        )}
      </div>
    </div>
  );

  const listSkeleton = (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (wos.isError && wos.data === undefined) {
    body = <ErrorState error={wos.error} onRetry={() => void wos.refetch()} retrying={wos.isFetching} />;
  } else if (invoices.isError && invoices.data === undefined) {
    body = (
      <ErrorState
        error={invoices.error}
        onRetry={() => void invoices.refetch()}
        retrying={invoices.isFetching}
      />
    );
  } else if (wos.isPending || invoices.isPending) {
    body = listSkeleton;
  } else if (timeline.length === 0) {
    body = (
      <EmptyState className="space-y-1 p-10">
        <p>{t("truck.history.empty")}</p>
        <p className="text-xs">{t("truck.history.emptyHint")}</p>
      </EmptyState>
    );
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground tabular" aria-live="polite">
          {t("truck.history.summary", {
            wos: fmtNumber((wos.data ?? []).length, lang),
            loaded: fmtNumber(loadedInvoices.length, lang),
            total: fmtNumber(totalInvoices, lang),
          })}
        </p>
        {shown.length === 0 ? (
          <EmptyState className="space-y-1">
            <p>{t("truck.history.noMatch", { q: filter.trim() })}</p>
            {hasMore && <p className="text-xs">{t("truck.history.filterLoadedOnly")}</p>}
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {shown.map((item) => (
              <TimelineRow key={item.key} item={item} truckId={truckId} />
            ))}
          </div>
        )}
        {hasMore && (
          <div className="flex flex-col items-center gap-1.5 pt-1">
            {needle && <p className="text-xs text-muted-foreground">{t("truck.history.filterLoadedOnly")}</p>}
            <Button
              variant="outline"
              onClick={() => void invoices.fetchNextPage()}
              disabled={invoices.isFetchingNextPage}
            >
              {invoices.isFetchingNextPage && <Loader2 className="animate-spin" />}
              {t("truck.history.loadMore", {
                n: fmtNumber(totalInvoices - loadedInvoices.length, lang),
              })}
            </Button>
            {invoices.isFetchNextPageError && (
              <p role="alert" className="text-sm text-destructive">
                {t("truck.history.loadMoreFailed")}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}
      {body}
    </div>
  );
}

function TimelineRow({ item, truckId }: { item: TimelineItem; truckId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const cls =
    "flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-4 text-start shadow-sm transition hover:border-border-strong hover:shadow-md";
  const km = item.kind === "wo" ? item.wo.odometer_at_open : item.inv.meter_reading;
  const count = item.kind === "wo" ? item.wo.task_count : item.inv.item_count;
  const detail =
    item.kind === "wo"
      ? [item.wo.title, item.wo.notes].map((s) => s?.trim()).filter(Boolean).join(" — ")
      : (item.inv.services_preview ?? "");

  const inner = (
    <>
      <div className="flex min-w-0 items-start gap-3">
        {item.kind === "wo" ? (
          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        ) : (
          <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold tabular">
            {fmtCairo(item.date, "YYYY/MM/DD", lang)}
            {km != null && <span className="font-normal text-muted-foreground"> · {fmtKm(km, lang)}</span>}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {detail || t("truck.history.itemsCount", { n: fmtNumber(count, lang) })}
          </div>
          {detail && (
            <div className="mt-0.5 text-xs text-muted-foreground tabular">
              {t("truck.history.itemsCount", { n: fmtNumber(count, lang) })}
            </div>
          )}
        </div>
      </div>
      <Badge className="flex-none" variant={item.kind === "wo" ? "default" : "secondary"}>
        {item.kind === "wo" ? t("truck.history.workshop") : t("truck.history.falcon")}
      </Badge>
    </>
  );

  return item.kind === "wo" ? (
    <Link to="/wo/$woId" params={{ woId: item.wo.id }} className={cls}>
      {inner}
    </Link>
  ) : (
    <Link
      to="/trucks/$truckId/history"
      params={{ truckId }}
      search={{ inv: item.inv.id }}
      className={cls}
    >
      {inner}
    </Link>
  );
}

/** One service invoice. Loading, failed, missing and loaded are four
 * different screens — a missing invoice is not an endless skeleton. */
function InvoiceView({ id, truckId }: { id: number; truckId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const invoice = useInvoice(id);
  const backCls =
    "flex min-h-10 w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground";

  return (
    <div className="space-y-3">
      {canGoBack ? (
        <button type="button" onClick={() => router.history.back()} className={backCls}>
          <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("truck.history.backToList")}
        </button>
      ) : (
        <Link to="/trucks/$truckId/history" params={{ truckId }} replace className={backCls}>
          <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("truck.history.backToList")}
        </Link>
      )}
      <QueryState query={invoice} skeleton={<Skeleton className="h-40 rounded-xl" />}>
        {(d) =>
          d == null ? (
            <EmptyState className="space-y-1 p-10">
              <p>{t("truck.history.invoiceMissing")}</p>
              <p className="text-xs">{t("truck.history.invoiceMissingHint")}</p>
            </EmptyState>
          ) : (
            <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold tabular">
                    {t("truck.history.invoiceTitle", { date: fmtCairo(d.date, "YYYY/MM/DD", lang) })}
                  </h2>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    {d.meter_reading != null && (
                      <>
                        <dt className="text-muted-foreground">{t("truck.odometer")}</dt>
                        <dd className="font-semibold tabular">{fmtKm(d.meter_reading, lang)}</dd>
                      </>
                    )}
                    {d.driver_name && (
                      <>
                        <dt className="text-muted-foreground">{t("trucks.driver")}</dt>
                        <dd className="font-semibold">{d.driver_name}</dd>
                      </>
                    )}
                    {d.supervisor && (
                      <>
                        <dt className="text-muted-foreground">{t("truck.history.supervisor")}</dt>
                        <dd className="font-semibold">{d.supervisor}</dd>
                      </>
                    )}
                    {d.operating_region && (
                      <>
                        <dt className="text-muted-foreground">{t("truck.history.region")}</dt>
                        <dd className="font-semibold">{d.operating_region}</dd>
                      </>
                    )}
                  </dl>
                </div>
                <Badge variant="secondary">{t("truck.history.falcon")}</Badge>
              </div>
              <h3 className="mb-2 text-sm font-bold">
                {t("truck.history.invoiceItems")} · {fmtNumber(d.items.length, lang)}
              </h3>
              {d.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("truck.history.invoiceNoItems")}</p>
              ) : (
                <ul className="space-y-2">
                  {d.items.map((it) => (
                    <li key={it.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                      <div>{it.service}</div>
                      {it.notes && <div className="mt-1 text-sm text-muted-foreground">{it.notes}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        }
      </QueryState>
    </div>
  );
}
