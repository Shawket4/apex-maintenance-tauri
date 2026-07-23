import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { TruckRow } from "@/shared/api/client";
import { useTrucks } from "@/shared/api/queries";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
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
  const { t } = useTranslation();
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
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (trucks.data ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("trucks.empty")}
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {(trucks.data ?? []).map((tr) => (
            <TruckCard key={tr.id} truck={tr} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The fleet card, per the design system: plate + status chips up top, a
 * labeled key/value grid, and a status FOOTER whose tint carries the single
 * most important fact about this truck. Everything shown is existing data. */
function TruckCard({ truck: tr }: { truck: TruckRow }) {
  const { t, i18n } = useTranslation();

  // Footer priority: overdue → due soon → chassis missing → all good.
  let footerClass = "text-muted-foreground";
  let dotClass = "bg-status-ok";
  let footerText: string;
  if (tr.overdue_count > 0) {
    footerClass = "bg-status-overdue-soft text-status-overdue";
    dotClass = "bg-current";
    footerText = `${fmtNumber(tr.overdue_count, i18n.language)} ${t("home.overdue")}`;
  } else if (tr.due_soon_count > 0) {
    footerClass = "bg-status-due_soon-soft text-status-due_soon";
    dotClass = "bg-current";
    footerText = `${fmtNumber(tr.due_soon_count, i18n.language)} ${t("home.dueSoon")}`;
  } else if (!tr.has_chassis) {
    footerClass = "bg-status-due_soon-soft text-status-due_soon";
    dotClass = "bg-current";
    footerText = t("trucks.noChassis");
  } else {
    footerText = t("due.status.ok");
  }

  return (
    <Link
      to="/trucks/$truckId"
      params={{ truckId: String(tr.id) }}
      className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:border-border-strong hover:shadow-md"
    >
      <div className="flex-1 px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="whitespace-nowrap text-[16.5px] font-bold tracking-wide">
            {tr.plate}
          </span>
          <div className="flex flex-none gap-1">
            {tr.open_wo_count > 0 && (
              <Badge className="bg-status-ok-soft text-status-ok hover:bg-status-ok-soft">
                {t("wo.status.open")}
              </Badge>
            )}
          </div>
        </div>
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-0.5 text-[12.5px]">
          <dt className="whitespace-nowrap text-muted-foreground">{t("truck.odometer")}</dt>
          <dd className="truncate font-semibold tabular">
            {tr.odometer
              ? `${fmtKm(tr.odometer.km, i18n.language)} · ${t(`truck.odometerSource.${tr.odometer.source}`)}`
              : "—"}
          </dd>
          <dt className="whitespace-nowrap text-muted-foreground">{t("trucks.driver")}</dt>
          <dd className={cn("truncate", tr.driver_name ? "font-semibold" : "text-muted-foreground")}>
            {tr.driver_name ?? "—"}
          </dd>
          <dt className="whitespace-nowrap text-muted-foreground">{t("truck.class")}</dt>
          <dd className={cn("truncate", tr.class_name_ar ? "font-semibold" : "text-muted-foreground")}>
            {tr.class_name_ar ?? t("trucks.unclassified")}
          </dd>
        </dl>
      </div>
      <div
        className={cn(
          "flex items-center gap-2 border-t px-4 py-2 text-xs font-semibold",
          footerClass,
        )}
      >
        <span className={cn("h-1.5 w-1.5 flex-none rounded-full", dotClass)} />
        <span className="truncate tabular">{footerText}</span>
      </div>
    </Link>
  );
}
