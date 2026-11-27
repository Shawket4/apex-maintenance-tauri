import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, Truck } from "lucide-react";

import { useTruck, useWo } from "@/shared/api/queries";
import { fmtKm } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { ErrorState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState, PageShell, Section } from "@/widgets/layout/PageShell";
import { SectionTitle } from "@/widgets/wo/parts";
import { WoDue } from "@/widgets/wo/WoDue";
import { WoHeader } from "@/widgets/wo/WoHeader";
import { WoNotes } from "@/widgets/wo/WoNotes";
import { WoOil } from "@/widgets/wo/WoOil";
import { WoPrintSheet } from "@/widgets/wo/WoPrintSheet";
import { WoTasks } from "@/widgets/wo/WoTasks";
import { WoBatteries } from "@/widgets/wo/WoBatteries";
import { WoTireOps } from "@/widgets/wo/WoTireOps";

export const Route = createFileRoute("/_app/wo/$woId/")({
  component: WoScreen,
});

/** The screen a mechanic lives in while the truck is in the bay: the order
 * itself up top, then tasks, oil, tire and battery work; the truck's facts, notes and
 * what it is due for alongside (below, on a phone). */
function WoScreen() {
  const { t } = useTranslation();
  const { woId } = Route.useParams();
  const wo = useWo(woId);

  // Three different states — a failed read is not "no such work order".
  if (wo.isError && wo.data === undefined) {
    return (
      <PageShell>
        <Crumbs />
        <ErrorState error={wo.error} onRetry={() => void wo.refetch()} retrying={wo.isFetching} />
      </PageShell>
    );
  }
  if (wo.isPending) {
    return (
      <PageShell>
        <div className="space-y-5" aria-busy="true">
          <Skeleton className="h-5 w-48 rounded" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </PageShell>
    );
  }
  const d = wo.data;
  if (!d) {
    return (
      <PageShell>
        <Crumbs />
        <EmptyState className="space-y-4 p-10">
          <div className="text-base font-semibold text-foreground">{t("wo.notFoundTitle")}</div>
          <div>{t("wo.notFoundBody")}</div>
          <Button asChild>
            <Link to="/wo">{t("wo.listTitle")}</Link>
          </Button>
        </EmptyState>
      </PageShell>
    );
  }
  const isOpen = d.wo.status === "open";

  return (
    <PageShell>
      {/* On paper only the sheet shows; everything interactive stays on screen. */}
      <WoPrintSheet d={d} />

      <div className="space-y-6 print:hidden">
        <Crumbs plate={d.wo.plate} vehicleId={d.wo.vehicle_id} />
        <WoHeader d={d} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-7">
            <WoTasks d={d} woId={woId} canEdit={isOpen} />
            <WoOil d={d} woId={woId} canEdit={isOpen} />
            <WoTireOps d={d} woId={woId} canEdit={isOpen} />
            <WoBatteries d={d} woId={woId} canEdit={isOpen} />
          </div>

          <aside className="min-w-0 space-y-7">
            <WoDue d={d} woId={woId} canAdd={isOpen} />
            <WoNotes wo={d.wo} />
            <VehicleCard vehicleId={d.wo.vehicle_id} plate={d.wo.plate} />
          </aside>
        </div>
      </div>
    </PageShell>
  );
}

/** Work orders › truck › this order. The truck link is always there, however
 * the screen was reached. */
function Crumbs({ plate, vehicleId }: { plate?: string; vehicleId?: number }) {
  const { t } = useTranslation();
  const sep = <ChevronRight className="h-4 w-4 flex-none text-muted-foreground rtl:-scale-x-100" />;
  const link = "flex min-h-10 items-center rounded font-medium text-muted-foreground hover:text-foreground";
  return (
    <nav aria-label={t("wo.crumbsLabel")} className="flex flex-wrap items-center gap-x-1.5 text-sm">
      <Link to="/wo" className={link}>
        {t("wo.listTitle")}
      </Link>
      {plate != null && vehicleId != null && (
        <>
          {sep}
          <Link to="/trucks/$truckId" params={{ truckId: String(vehicleId) }} className={link}>
            <bdi>{plate}</bdi>
          </Link>
          {sep}
          <span className="font-semibold text-foreground">{t("wo.title")}</span>
        </>
      )}
    </nav>
  );
}

function VehicleCard({ vehicleId, plate }: { vehicleId: number; plate: string }) {
  const { t, i18n } = useTranslation();
  const truck = useTruck(vehicleId);
  const tr = truck.data;
  return (
    <Section title={<SectionTitle>{t("wo.vehicle")}</SectionTitle>}>
      <div className="space-y-3 rounded-xl border bg-card px-4 py-4 shadow-sm">
        {truck.isError && !tr ? (
          <ErrorState error={truck.error} onRetry={() => void truck.refetch()} retrying={truck.isFetching} />
        ) : truck.isPending ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("trucks.driver")}</dt>
            <dd dir="auto" className="break-words font-semibold">
              {tr?.driver_name ?? "—"}
            </dd>
            <dt className="text-muted-foreground">{t("truck.class")}</dt>
            <dd className="break-words font-semibold">
              {tr?.class_name_ar ?? t("trucks.unclassified")}
            </dd>
            <dt className="text-muted-foreground">{t("wo.vehicleOdometer")}</dt>
            <dd className="break-words font-semibold tabular">
              {tr?.odometer ? (
                <>
                  {fmtKm(tr.odometer.km, i18n.language)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({t(`truck.odometerSource.${tr.odometer.source}`)})
                  </span>
                </>
              ) : (
                t("wo.odoMissing")
              )}
            </dd>
          </dl>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link to="/trucks/$truckId" params={{ truckId: String(vehicleId) }}>
            <Truck />
            <span>
              {t("wo.goTruck")} <bdi>{plate}</bdi>
            </span>
          </Link>
        </Button>
      </div>
    </Section>
  );
}
