import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Gauge, User } from "lucide-react";

import { useTrucks } from "@/shared/api/queries";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { DUE_BADGE } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/trucks/")({
  // Search text lives in the URL so back-navigation restores the filter.
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === "string" && s.q ? { q: s.q } : {},
  component: TrucksPage,
});

function TrucksPage() {
  const { t, i18n } = useTranslation();
  const { q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setQ = (v: string) =>
    void navigate({ search: v ? { q: v } : {}, replace: true });
  const trucks = useTrucks(q || undefined);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("trucks.title")}</h1>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("trucks.searchPlaceholder")}
          className="max-w-xs"
          dir="auto"
        />
      </div>

      {trucks.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (trucks.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("trucks.empty")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(trucks.data ?? []).map((tr) => (
            <Link
              key={tr.id}
              to="/trucks/$truckId"
              params={{ truckId: String(tr.id) }}
              className="rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-lg font-bold tracking-wide">{tr.plate}</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {tr.open_wo_count > 0 && (
                    <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                      {t("wo.status.open")}
                    </Badge>
                  )}
                  {tr.overdue_count > 0 && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", DUE_BADGE.overdue)}>
                      {fmtNumber(tr.overdue_count)}
                    </span>
                  )}
                  {tr.due_soon_count > 0 && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", DUE_BADGE.due_soon)}>
                      {fmtNumber(tr.due_soon_count)}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 tabular">
                  <Gauge className="h-3.5 w-3.5" />
                  {tr.odometer ? fmtKm(tr.odometer.km, i18n.language) : "—"}
                </div>
                {tr.driver_name && (
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {tr.driver_name}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span>{tr.class_name_ar ?? t("trucks.unclassified")}</span>
                  {!tr.has_chassis && (
                    <span className="text-status-due_soon">{t("trucks.noChassis")}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
