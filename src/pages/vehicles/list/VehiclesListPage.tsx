/**
 * Vehicles list page (Phase 2).
 *
 * Architecture mapping:
 *   §4.1  — read-through cache: shows the local SQLite mirror immediately,
 *           calls /cache/vehicles in the background to refresh.
 *   §13.5 — bilingual columns; numeric columns render with tabular-nums;
 *           expiration cells colour-coded by urgency.
 *
 * Columns: plate · type · tank capacity · transporter · driver · odometer ·
 *          car license · calibration · tank license.
 *
 * Plates are centered horizontally regardless of script so the column reads
 * cleanly with mixed Arabic / Latin numbers.
 *
 * Headers: full text, no `uppercase` or `tracking-*` (which played badly
 * with Arabic glyphs and made shorter columns clip the label).
 */

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Truck } from "lucide-react";
import { SearchInput } from "@/shared/ui/SearchInput";
import { Card, CardContent } from "@/shared/ui/card";
import {
  expirationStatus,
  type ExpirationStatus,
  type VehicleRow,
} from "@/entities/vehicle/model";
import {
  useVehiclesAutoRefresh,
  useVehiclesQuery,
  useVehiclesRefresh,
} from "@/shared/api/vehicles";
import { CacheFreshnessIndicator } from "@/widgets/CacheFreshnessIndicator/CacheFreshnessIndicator";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";

// Wider columns + headers fit in their cell at all locales.
// Total fixed: 180+150+130+1fr+1fr+150+150+150+150 ≈ 1060 + flex.
const GRID = "grid-cols-[180px_150px_130px_minmax(140px,1fr)_minmax(140px,1fr)_150px_150px_150px_150px]";
const ROW_HEIGHT = 56;

export function VehiclesListPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? "ar";

  const vehiclesQ = useVehiclesQuery();
  const refresh = useVehiclesRefresh();
  useVehiclesAutoRefresh(true);

  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () => filterVehicles(vehiclesQ.data ?? [], filter),
    [vehiclesQ.data, filter],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("vehicles.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("vehicles.subtitle", { formattedCount: fmtNumber(filtered.length, locale) })}
            </p>
          </div>
        </div>

        <CacheFreshnessIndicator
          cacheName="vehicles"
          onRefresh={() => refresh.mutate()}
          isRefreshing={refresh.isPending}
        />
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border p-3">
            <SearchInput
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("vehicles.search_placeholder")}
            />
          </div>

          {vehiclesQ.isLoading ? (
            <EmptyState message={t("actions.loading")} />
          ) : vehiclesQ.isError ? (
            <EmptyState message={t("vehicles.error")} variant="error" />
          ) : filtered.length === 0 ? (
            <EmptyState
              message={
                vehiclesQ.data && vehiclesQ.data.length === 0
                  ? t("vehicles.empty_total")
                  : t("vehicles.empty_filtered")
              }
            />
          ) : (
            <VehiclesTable rows={filtered} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VehiclesTable({ rows }: { rows: VehicleRow[] }) {
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
      <div role="table" className="min-w-[1480px] text-sm" style={{ width: "100%" }}>
        {/* Sticky header */}
        <div role="rowgroup" className="sticky top-0 z-10 bg-card border-b border-border">
          <div
            role="row"
            className={cn(
              "grid gap-3 px-4 py-2.5 text-xs font-semibold text-muted-foreground",
              GRID,
            )}
          >
            <div role="columnheader" className="text-center">
              {t("vehicles.col.plate")}
            </div>
            <div role="columnheader">{t("vehicles.col.type")}</div>
            <div role="columnheader" className="text-end tabular">
              {t("vehicles.col.tank_capacity")}
            </div>
            <div role="columnheader">{t("vehicles.col.transporter")}</div>
            <div role="columnheader">{t("vehicles.col.driver")}</div>
            <div role="columnheader" className="text-end tabular">
              {t("vehicles.col.odometer")}
            </div>
            <div role="columnheader" className="text-end">
              {t("vehicles.col.car_license")}
            </div>
            <div role="columnheader" className="text-end">
              {t("vehicles.col.calibration")}
            </div>
            <div role="columnheader" className="text-end">
              {t("vehicles.col.tank_license")}
            </div>
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
              <div
                key={r.id}
                role="row"
                className={cn(
                  "absolute inset-x-0 grid items-center px-4 gap-3 border-b border-border/50 hover:bg-accent/40 transition-colors",
                  GRID,
                )}
                style={{
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {/* Plate — centered, monospace-ish for Arabic plates */}
                <div
                  role="cell"
                  className="font-medium tabular text-center truncate"
                  title={r.car_no_plate}
                >
                  {r.car_no_plate}
                </div>

                <div role="cell" className="truncate text-muted-foreground" title={r.car_type ?? ""}>
                  {r.car_type ?? "—"}
                </div>

                <div role="cell" className="text-end tabular text-muted-foreground">
                  {r.tank_capacity != null
                    ? `${fmtNumber(r.tank_capacity, locale)} ${t("vehicles.unit.liters")}`
                    : "—"}
                </div>

                <div role="cell" className="truncate text-muted-foreground" title={r.transporter ?? ""}>
                  {r.transporter ?? "—"}
                </div>

                <div role="cell" className="truncate" title={r.driver_name ?? ""}>
                  {r.driver_name ?? <span className="text-muted-foreground">—</span>}
                </div>

                <div role="cell" className="text-end tabular">
                  {fmtKm(r.last_fuel_odometer, locale)}
                </div>

                <ExpirationCell isoDate={r.license_expiration_date} locale={locale} />
                <ExpirationCell isoDate={r.calibration_expiration_date} locale={locale} />
                <ExpirationCell
                  isoDate={r.tank_license_expiration_date}
                  locale={locale}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExpirationCell({
  isoDate,
  locale,
}: {
  isoDate: string | null;
  locale: string;
}) {
  const status = expirationStatus(isoDate);
  return (
    <div role="cell" className="text-end">
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs tabular",
          colorForStatus(status),
        )}
      >
        {(status === "overdue" || status === "due_soon") && (
          <AlertTriangle className="h-3 w-3" />
        )}
        {isoDate ? fmtCairo(isoDate, "YYYY/MM/DD", locale) : "—"}
      </span>
    </div>
  );
}

function colorForStatus(status: ExpirationStatus) {
  switch (status) {
    case "overdue":
      return "bg-destructive/10 text-destructive";
    case "due_soon":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "ok":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "missing":
    default:
      return "bg-muted text-muted-foreground";
  }
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

function filterVehicles(rows: VehicleRow[], q: string): VehicleRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((v) => {
    const haystack = [v.car_no_plate, v.car_type, v.transporter, v.driver_name]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
