/**
 * Service-invoices step 1: pick a vehicle.
 *
 * Compact card grid rather than the full vehicles table — this view's job
 * is "which truck do you want invoices for?", not full fleet management.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Truck, Wrench } from "lucide-react";

import { SearchInput } from "@/shared/ui/SearchInput";
import { ExportExcelButton } from "@/shared/ui/ExportExcelButton";
import { Card, CardContent } from "@/shared/ui/card";
import {
  useVehiclesAutoRefresh,
  useVehiclesQuery,
  useVehiclesRefresh,
} from "@/shared/api/vehicles";
import { CacheFreshnessIndicator } from "@/widgets/CacheFreshnessIndicator/CacheFreshnessIndicator";
import { fmtNumber } from "@/shared/lib/numbers";
import { cn } from "@/shared/lib/cn";
import type { VehicleRow } from "@/entities/vehicle/model";

export function ServiceInvoicesIndexPage() {
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
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("serviceInvoices.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("serviceInvoices.pickVehicle", {
                formattedCount: fmtNumber(filtered.length, locale),
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ExportExcelButton
            disabled={filtered.length === 0}
            config={() => ({
              filename: "invoice_pick_list",
              sheets: [
                {
                  name: "Vehicles",
                  title: t("serviceInvoices.title"),
                  subtitle: t("serviceInvoices.pickVehicle", { formattedCount: fmtNumber(filtered.length, locale) }),
                  isRtl: i18n.dir() === "rtl",
                  columns: [
                    { key: "car_no_plate", header: t("vehicles.col.plate"), width: 15 },
                    { key: "car_type", header: t("vehicles.col.type"), width: 15 },
                    { key: "transporter", header: t("vehicles.col.transporter"), width: 20 },
                    { key: "tank_capacity", header: t("vehicles.col.tank_capacity"), type: "integer" },
                    { key: "driver_name", header: t("vehicles.col.driver"), width: 20 },
                  ],
                  rows: filtered,
                },
              ],
            })}
          />

          <CacheFreshnessIndicator
            cacheName="vehicles"
            onRefresh={() => refresh.mutate()}
            isRefreshing={refresh.isPending}
          />
        </div>
      </header>

      <Card>
        <CardContent className="p-3">
          <SearchInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("vehicles.search_placeholder")}
            className="mb-3"
          />

          {vehiclesQ.isLoading ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              {t("actions.loading")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-12 text-center text-sm text-muted-foreground">
              {vehiclesQ.data && vehiclesQ.data.length === 0
                ? t("vehicles.empty_total")
                : t("vehicles.empty_filtered")}
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {filtered.map((v) => (
                <li key={v.id}>
                  <VehicleTile vehicle={v} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VehicleTile({ vehicle }: { vehicle: VehicleRow }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? "ar";
  return (
    <Link
      to="/service-invoices/$vehicleId"
      params={{ vehicleId: String(vehicle.id) }}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border bg-background p-3 transition-colors",
        "hover:border-primary/40 hover:bg-accent/40",
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Truck className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold tabular text-center sm:text-start">
          {vehicle.car_no_plate}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[vehicle.car_type, vehicle.transporter]
            .filter(Boolean)
            .join(" · ") ||
            (vehicle.driver_name ?? t("serviceInvoices.noDriver"))}
        </p>
        {vehicle.tank_capacity != null && (
          <p className="text-[11px] tabular text-muted-foreground/80">
            {fmtNumber(vehicle.tank_capacity, locale)} {t("vehicles.unit.liters")}
          </p>
        )}
      </div>
      <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180 rtl:rotate-0 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
    </Link>
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
