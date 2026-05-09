/**
 * Service-invoices step 2: list invoices for the picked vehicle. Click an
 * invoice → detail page.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, ChevronLeft, Receipt } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import {
  useInvoicesAutoRefresh,
  useInvoicesQuery,
  useInvoicesRefresh,
} from "@/shared/api/invoices";
import { useVehiclesQuery } from "@/shared/api/vehicles";
import { CacheFreshnessIndicator } from "@/widgets/CacheFreshnessIndicator/CacheFreshnessIndicator";
import { fmtNumber, fmtKm } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import type { InvoiceRow } from "@/entities/invoice/model";
import type { VehicleRow } from "@/entities/vehicle/model";

const PAGE_SIZE = 100;
const ROW_HEIGHT = 64;

export function ServiceInvoicesByVehiclePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? "ar";
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { vehicleId?: string };
  const vehicleId = Number(params.vehicleId ?? 0);

  const [page, setPage] = useState(1);
  const listQ = useInvoicesQuery(page, PAGE_SIZE, vehicleId);
  const refresh = useInvoicesRefresh();
  useInvoicesAutoRefresh(true);

  const vehiclesQ = useVehiclesQuery();
  const vehicle: VehicleRow | undefined = useMemo(
    () => vehiclesQ.data?.find((v) => v.id === vehicleId),
    [vehiclesQ.data, vehicleId],
  );

  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/service-invoices" })}
            aria-label={t("actions.back")}
          >
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-primary/10 text-primary grid place-items-center">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tabular">
                {vehicle?.car_no_plate ?? t("serviceInvoices.unknownVehicle")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("serviceInvoices.subtitleByVehicle", {
                  formattedCount: fmtNumber(total, locale),
                })}
              </p>
            </div>
          </div>
        </div>

        <CacheFreshnessIndicator
          cacheName="service_invoices"
          onRefresh={() => refresh.mutate()}
          isRefreshing={refresh.isPending}
        />
      </header>

      <Card>
        <CardContent className="p-0">
          {listQ.isLoading ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              {t("actions.loading")}
            </p>
          ) : listQ.isError ? (
            <p className="p-12 text-center text-sm text-destructive">
              {t("invoices.error")}
            </p>
          ) : rows.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              {t("serviceInvoices.empty")}
            </p>
          ) : (
            <InvoicesTable rows={rows} vehicleId={vehicleId} />
          )}

          {total > PAGE_SIZE && (
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

function InvoicesTable({
  rows,
  vehicleId,
}: {
  rows: InvoiceRow[];
  vehicleId: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? "ar";
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="max-h-[68vh] overflow-auto">
      <div role="table" className="min-w-[900px] text-sm" style={{ width: "100%" }}>
        <div role="rowgroup" className="sticky top-0 z-10 bg-card border-b border-border">
          <div
            role="row"
            className="grid grid-cols-[140px_1fr_140px_120px_100px_100px_60px] gap-3 px-4 py-2.5 text-xs font-semibold text-muted-foreground"
          >
            <div role="columnheader">{t("invoices.col.date")}</div>
            <div role="columnheader">{t("invoices.col.services")}</div>
            <div role="columnheader">{t("invoices.col.driver")}</div>
            <div role="columnheader">{t("invoices.col.region")}</div>
            <div role="columnheader" className="text-end tabular">
              {t("invoices.col.items")}
            </div>
            <div role="columnheader" className="text-end tabular">
              {t("invoices.col.meter")}
            </div>
            <div role="columnheader" />
          </div>
        </div>

        <div
          role="rowgroup"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const r = rows[vi.index]!;
            return (
              <Link
                key={r.id}
                to="/service-invoices/$vehicleId/$invoiceId"
                params={{
                  vehicleId: String(vehicleId),
                  invoiceId: String(r.id),
                }}
                role="row"
                className="absolute inset-x-0 grid grid-cols-[140px_1fr_140px_120px_100px_100px_60px] gap-3 items-center px-4 border-b border-border/50 hover:bg-accent/40 transition-colors cursor-pointer"
                style={{
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <div className="tabular text-muted-foreground">
                  {r.date ? fmtCairo(r.date, "YYYY/MM/DD", locale) : "—"}
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
                <div className="flex justify-end text-muted-foreground">
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
