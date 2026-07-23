import { Link, Outlet, createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Gauge, User } from "lucide-react";

import { useTruck, useWos } from "@/shared/api/queries";
import { fmtKm } from "@/shared/lib/numbers";
import { fmtAgo } from "@/shared/lib/time";
import { OpenWoDialog } from "@/widgets/wo/OpenWoDialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/trucks/$truckId")({
  component: TruckLayout,
});

const TABS = [
  { to: "/trucks/$truckId", key: "truck.tabs.overview", exact: true },
  { to: "/trucks/$truckId/tires", key: "truck.tabs.tires", exact: false },
  { to: "/trucks/$truckId/history", key: "truck.tabs.history", exact: false },
  { to: "/trucks/$truckId/due", key: "truck.tabs.due", exact: false },
] as const;

function TruckLayout() {
  const { t, i18n } = useTranslation();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  const truck = useTruck(vid);
  const openWos = useWos("open", vid);

  const openWo = (openWos.data ?? [])[0];

  return (
    <PageShell>
      <TruckBackLink />

      {truck.isLoading ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : truck.data ? (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-bold tracking-wide">{truck.data.plate}</div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="rounded bg-muted px-2 py-0.5">
                  {truck.data.class_name_ar ?? t("trucks.unclassified")}
                </span>
                <span className="flex items-center gap-1 tabular">
                  <Gauge className="h-4 w-4" />
                  {truck.data.odometer ? fmtKm(truck.data.odometer.km, i18n.language) : "—"}
                  {truck.data.odometer && (
                    <span className="text-xs">
                      ({t(`truck.odometerSource.${truck.data.odometer.source}`)}
                      {truck.data.odometer.observed_at
                        ? ` · ${fmtAgo(truck.data.odometer.observed_at, i18n.language)}`
                        : ""})
                    </span>
                  )}
                </span>
                {truck.data.driver_name && (
                  <span className="flex items-center gap-1">
                    <User className="h-4 w-4" /> {truck.data.driver_name}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {openWo ? (
                <Link to="/wo/$woId" params={{ woId: openWo.id }}>
                  <Button variant="secondary">
                    <Badge className="bg-status-ok-soft text-status-ok hover:bg-status-ok-soft">
                      {t("wo.status.open")}
                    </Badge>
                    {t("truck.resumeWo")}
                  </Button>
                </Link>
              ) : (
                <OpenWoDialog vehicleId={vid} odometer={truck.data.odometer} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState>{t("common.notFound")}</EmptyState>
      )}

      <div className="flex gap-1 rounded-xl border bg-card p-1 shadow-sm">
        {TABS.map(({ to, key, exact }) => (
          <Link
            key={key}
            to={to}
            params={{ truckId }}
            replace
            activeOptions={{ exact }}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent [&.active]:bg-primary [&.active]:text-primary-foreground [&.active]:shadow-sm"
          >
            {t(key)}
          </Link>
        ))}
      </div>

      <Outlet />
    </PageShell>
  );
}

/** Back to wherever the truck was opened from (home, fleet, search, due);
 * fleet list on a cold entry. */
function TruckBackLink() {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const cls = "flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground";
  if (canGoBack) {
    return (
      <button onClick={() => router.history.back()} className={cls}>
        <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("common.back")}
      </button>
    );
  }
  return (
    <Link to="/trucks" className={cls}>
      <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {t("trucks.title")}
    </Link>
  );
}
