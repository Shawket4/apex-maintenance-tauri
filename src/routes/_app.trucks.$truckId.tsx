import { Link, Outlet, createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CalendarClock,
  CircleDot,
  Gauge,
  History,
  LayoutDashboard,
  User,
} from "lucide-react";

import { useTruck, useWos } from "@/shared/api/queries";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState, PageShell } from "@/widgets/layout/PageShell";
import { Plate } from "@/widgets/truck/Plate";
import { TruckWoAction } from "@/widgets/truck/TruckWoAction";

export const Route = createFileRoute("/_app/trucks/$truckId")({
  component: TruckLayout,
});

const TABS = [
  { to: "/trucks/$truckId", key: "truck.tabs.overview", icon: LayoutDashboard, exact: true },
  { to: "/trucks/$truckId/tires", key: "truck.tabs.tires", icon: CircleDot, exact: false },
  { to: "/trucks/$truckId/history", key: "truck.tabs.history", icon: History, exact: false },
  { to: "/trucks/$truckId/due", key: "truck.tabs.due", icon: CalendarClock, exact: false },
] as const;

function TruckLayout() {
  const { t, i18n } = useTranslation();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  const validId = Number.isInteger(vid) && vid > 0;
  const truck = useTruck(validId ? vid : 0);
  const openWos = useWos("open", validId ? vid : undefined);

  if (!validId) {
    return (
      <PageShell>
        <TruckBackLink />
        <TruckNotFound />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <TruckBackLink />

      <QueryState query={truck} skeleton={<Skeleton className="h-32 rounded-xl" />}>
        {(tr) =>
          tr == null ? (
            <TruckNotFound />
          ) : (
            <>
              <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold">
                      <Plate>{tr.plate}</Plate>
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5 tabular">
                        <Gauge className="h-4 w-4 flex-none" />
                        {tr.odometer ? fmtKm(tr.odometer.km, i18n.language) : t("trucks.noOdometer")}
                      </span>
                      {tr.driver_name && (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <User className="h-4 w-4 flex-none" />
                          <span className="truncate">{tr.driver_name}</span>
                        </span>
                      )}
                      {tr.class_id ? (
                        <span className="rounded bg-muted px-2 py-0.5">{tr.class_name_ar}</span>
                      ) : (
                        <Link
                          to="/trucks/$truckId"
                          params={{ truckId }}
                          hash="class"
                          className="rounded bg-status-overdue-soft px-2 py-0.5 font-semibold text-status-overdue underline"
                        >
                          {t("truck.noClassChip")}
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-none flex-col items-stretch gap-2 sm:items-end">
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                      <TruckWoAction
                        vehicleId={vid}
                        odometer={tr.odometer}
                        openWos={openWos.data ?? []}
                        loading={openWos.isPending}
                        failed={openWos.isError && openWos.data === undefined}
                        onRetry={() => void openWos.refetch()}
                        allowAnother
                      />
                    </div>
                    {(openWos.data ?? []).length > 1 && (
                      <p className="text-sm text-status-due_soon tabular">
                        {t("truck.manyOpenWos", {
                          n: fmtNumber((openWos.data ?? []).length, i18n.language),
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Underline tabs. The row scrolls sideways on a narrow phone
               * instead of squeezing or wrapping. */}
              <nav
                aria-label={t("truck.tabsLabel")}
                className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none]"
              >
                {TABS.map(({ to, key, icon: Icon, exact }) => (
                  <Link
                    key={key}
                    to={to}
                    params={{ truckId }}
                    replace
                    activeOptions={{ exact, includeSearch: false, includeHash: false }}
                    className="group relative flex min-h-11 flex-none items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 pb-3 pt-2 text-sm font-medium text-muted-foreground transition hover:bg-primary/[0.04] hover:text-foreground [&.active]:font-semibold [&.active]:text-primary"
                  >
                    <Icon className="h-4 w-4 opacity-70 transition group-[.active]:opacity-100" />
                    {t(key)}
                    <span className="absolute inset-x-2.5 bottom-0 hidden h-[2.5px] rounded-full bg-primary group-[.active]:block" />
                  </Link>
                ))}
              </nav>

              <Outlet />
            </>
          )
        }
      </QueryState>
    </PageShell>
  );
}

function TruckNotFound() {
  const { t } = useTranslation();
  return (
    <EmptyState className="space-y-3 p-10">
      <p>{t("truck.notFound")}</p>
      <Link to="/trucks" className="inline-block font-semibold text-primary underline">
        {t("truck.backToTrucks")}
      </Link>
    </EmptyState>
  );
}

/** Back to wherever the truck was opened from (home, fleet, search, due);
 * fleet list on a cold entry. */
function TruckBackLink() {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const cls =
    "flex min-h-10 w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground";
  if (canGoBack) {
    return (
      <button type="button" onClick={() => router.history.back()} className={cls}>
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
