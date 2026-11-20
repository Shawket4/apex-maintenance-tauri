import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ChevronRight, ClipboardList, PackageOpen, Search, Settings2, Truck } from "lucide-react";

import type { DueRow } from "@/shared/api/client";
import { useHome } from "@/shared/api/queries";
import { fmtKm, fmtLiters, fmtNumber } from "@/shared/lib/numbers";
import { dayjs, fmtAgo, fmtCairo } from "@/shared/lib/time";
import { DUE_BADGE, DUE_DOT } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { QueryState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { StatusChip } from "@/shared/ui/status-chip";
import { EmptyState, ListCard, PageShell } from "@/widgets/layout/PageShell";
import { openOmnisearch } from "@/widgets/shell/Omnisearch";

export const Route = createFileRoute("/_app/")({
  component: HomePage,
});

/** The work-order list (`/wo`). Typed loosely so this file does not depend on
 * when that route's generated types land. */
const WO_LIST: string = "/wo";

/** How many open work orders the home page shows before "see all". */
const OPEN_WO_PREVIEW = 6;

/** How late (or how close) a due row is, in words. */
function dueWords(d: DueRow, t: TFunction, locale: string): string {
  if (d.status === "never_done") return t("home.neverRecorded");
  if (d.status === "unknown") return t("home.needsOdometer");
  const parts: string[] = [];
  if (d.status === "overdue") {
    if (d.km_remaining != null && d.km_remaining < 0) {
      parts.push(t("home.lateKm", { km: fmtKm(-d.km_remaining, locale) }));
    }
    if (d.days_remaining != null && d.days_remaining < 0) {
      parts.push(t("home.lateDays", { count: -d.days_remaining, n: fmtNumber(-d.days_remaining, locale) }));
    }
    return parts.length > 0 ? parts.join(t("home.and")) : t("home.status.overdue");
  }
  if (d.km_remaining != null && d.km_remaining >= 0) {
    parts.push(t("home.leftKm", { km: fmtKm(d.km_remaining, locale) }));
  }
  if (d.days_remaining != null && d.days_remaining >= 0) {
    parts.push(t("home.leftDays", { count: d.days_remaining, n: fmtNumber(d.days_remaining, locale) }));
  }
  return parts.join(t("home.or"));
}

const DOT_FALLBACK = "bg-status-never_done";
const BADGE_FALLBACK = "bg-status-never_done-soft text-status-never_done";

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 className="text-base font-bold">{children}</h2>
      {action}
    </div>
  );
}

function SeeAll({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex min-h-11 items-center gap-0.5 text-sm font-semibold text-primary hover:underline">
      {children}
      <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
    </Link>
  );
}

/** A number that opens the list it counts. */
function KpiLink({
  to,
  value,
  label,
  tone,
}: {
  to: string;
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[84px] flex-col justify-center rounded-xl border bg-card px-4 py-3 shadow-sm transition hover:border-border-strong hover:shadow-md"
    >
      <span className={cn("text-[27px] font-bold leading-snug tabular", tone)}>{value}</span>
      <span className="flex items-center justify-between gap-1 text-sm text-muted-foreground">
        {label}
        <ChevronRight className="h-4 w-4 flex-none rtl:-scale-x-100" />
      </span>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[84px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

/** الورشة — what needs doing today. Every number opens the list it counts;
 * setup gaps and refused changes are said out loud at the top. */
function HomePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const ar = locale.startsWith("ar");
  const home = useHome();
  const n = (v: number) => fmtNumber(v, locale);

  return (
    <PageShell
      title={t("home.title")}
      subtitle={<span className="text-sm">{dayjs().tz("Africa/Cairo").locale(locale).format("dddd D MMMM")}</span>}
    >
      {/* What a garage starts the day with. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" className="justify-start sm:justify-center" onClick={openOmnisearch}>
          <Search />
          {t("home.findTruck")}
        </Button>
        <Button asChild size="lg" variant="outline" className="justify-start sm:justify-center">
          <Link to={WO_LIST}>
            <ClipboardList />
            {t("home.allWorkOrders")}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="justify-start sm:justify-center">
          <Link to="/trucks">
            <Truck />
            {t("home.allTrucks")}
          </Link>
        </Button>
      </div>

      <QueryState query={home} skeleton={<HomeSkeleton />}>
        {(data) => {
          const dc = data.due_counts;
          const shownWos = data.open_wos.slice(0, OPEN_WO_PREVIEW);
          const lowStock = data.low_stock_tires.length + data.low_stock_oil.length;
          return (
            <>
              {(data.sync_issues > 0 || dc.unclassified_trucks > 0) && (
                <div className="space-y-2">
                  {data.sync_issues > 0 && (
                    <Link
                      to="/settings"
                      hash="sync"
                      className="flex min-h-11 items-center gap-3 rounded-xl border border-status-overdue/30 bg-status-overdue-soft px-4 py-3 text-sm font-semibold text-status-overdue"
                    >
                      <AlertTriangle className="h-5 w-5 flex-none" />
                      <span className="min-w-0 flex-1">{t("home.syncIssues", { n: n(data.sync_issues) })}</span>
                      <ChevronRight className="h-4 w-4 flex-none rtl:-scale-x-100" />
                    </Link>
                  )}
                  {dc.unclassified_trucks > 0 && (
                    <Link
                      to="/settings"
                      hash="truck-classes"
                      className="flex min-h-11 items-center gap-3 rounded-xl border border-status-due_soon/40 bg-status-due_soon-soft px-4 py-3 text-sm font-semibold text-status-due_soon"
                    >
                      <Settings2 className="h-5 w-5 flex-none" />
                      <span className="min-w-0 flex-1">{t("home.unclassified", { n: n(dc.unclassified_trucks) })}</span>
                      <ChevronRight className="h-4 w-4 flex-none rtl:-scale-x-100" />
                    </Link>
                  )}
                </div>
              )}

              {/* Each tile counts exactly the rows of the list it opens. */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiLink to={WO_LIST} value={n(data.open_wos.length)} label={t("home.kpiOpen")} />
                <KpiLink to="/due" value={n(dc.overdue)} label={t("home.status.overdue")} tone={dc.overdue > 0 ? "text-status-overdue" : undefined} />
                <KpiLink to="/due" value={n(dc.never_done)} label={t("home.status.never_done")} tone={dc.never_done > 0 ? "text-status-never_done" : undefined} />
                <KpiLink to="/due" value={n(dc.due_soon)} label={t("home.status.due_soon")} tone={dc.due_soon > 0 ? "text-status-due_soon" : undefined} />
              </div>

              {/* Open work orders — the resume-work path. */}
              <section>
                <SectionTitle
                  action={data.open_wos.length > 0 && <SeeAll to={WO_LIST}>{t("home.viewAll")}</SeeAll>}
                >
                  {t("home.openWos")}
                </SectionTitle>
                {data.open_wos.length === 0 ? (
                  <EmptyState>{t("home.noOpenWos")}</EmptyState>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {shownWos.map((w) => (
                      <Link
                        key={w.id}
                        to="/wo/$woId"
                        params={{ woId: w.id }}
                        className="rounded-xl border bg-card p-4 text-start shadow-sm transition hover:border-border-strong hover:shadow-md"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <bdi className="whitespace-nowrap text-[17px] font-bold">{w.plate}</bdi>
                          {w.pending && (
                            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                              {t("home.notSentYet")}
                            </span>
                          )}
                        </div>
                        {w.title && (
                          <div className="mt-0.5 truncate text-sm" dir="auto">
                            {w.title}
                          </div>
                        )}
                        <div className="mt-1 text-sm text-muted-foreground tabular">
                          {t("home.openedOn", { date: fmtCairo(w.opened_at, "YYYY/MM/DD", locale) })}
                          <span className="text-xs"> ({fmtAgo(w.opened_at, locale)})</span>
                        </div>
                        <div className="mt-0.5 text-sm text-muted-foreground tabular">
                          {w.task_count > 0
                            ? t("home.tasksDone", { done: n(w.done_count), total: n(w.task_count) })
                            : t("home.noTasksYet")}
                        </div>
                        <div className="mt-3 flex items-center gap-1 text-sm font-semibold text-primary">
                          {t("home.resume")}
                          <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {data.open_wos.length > shownWos.length && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("home.moreWos", { n: n(data.open_wos.length - shownWos.length) })}
                  </p>
                )}
              </section>

              {/* Most urgent first (the summary sorts them). */}
              <section>
                <SectionTitle action={<SeeAll to="/due">{t("home.viewAllDue")}</SeeAll>}>{t("home.attention")}</SectionTitle>
                {data.attention.length === 0 ? (
                  <EmptyState className="p-6">
                    {dc.overdue + dc.never_done + dc.due_soon === 0 && dc.unclassified_trucks > 0
                      ? t("home.noAttentionUntracked")
                      : t("home.noAttention")}
                  </EmptyState>
                ) : (
                  <ListCard>
                    {data.attention.map((d) => (
                      <Link
                        key={`${d.vehicle_id}-${d.plan_id}`}
                        to="/trucks/$truckId"
                        params={{ truckId: String(d.vehicle_id) }}
                        className="flex min-h-14 items-center gap-3 px-4 py-3 transition hover:bg-primary/[0.03]"
                      >
                        <span className={cn("h-2.5 w-2.5 flex-none rounded-full", DUE_DOT[d.status] ?? DOT_FALLBACK)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <bdi className="whitespace-nowrap font-bold">{d.plate}</bdi>
                            <span className="text-sm">{ar ? d.category_name_ar : d.category_name_en}</span>
                          </div>
                          <div className="text-sm text-muted-foreground tabular">{dueWords(d, t, locale)}</div>
                        </div>
                        <StatusChip tone={DUE_BADGE[d.status] ?? BADGE_FALLBACK} className="flex-none whitespace-nowrap px-2.5">
                          {t(`home.status.${d.status}`, { defaultValue: t("home.status.unknown") })}
                        </StatusChip>
                        <ChevronRight className="h-4 w-4 flex-none text-muted-foreground rtl:-scale-x-100" />
                      </Link>
                    ))}
                  </ListCard>
                )}
              </section>

              {/* Low stock — tires and oil. */}
              {lowStock > 0 && (
                <section>
                  <SectionTitle action={<SeeAll to="/tires">{t("home.openStock")}</SeeAll>}>
                    <span className="flex items-center gap-2 text-status-due_soon">
                      <PackageOpen className="h-5 w-5" />
                      {t("home.lowStock")}
                    </span>
                  </SectionTitle>
                  <ListCard className="border-status-due_soon/40">
                    {data.low_stock_tires.map((l) => (
                      <div key={`t-${l.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="min-w-0">
                          <span className="text-muted-foreground">{t("home.stockTire")} </span>
                          <bdi className="font-semibold">{[l.brand, l.model, l.size].filter(Boolean).join(" ")}</bdi>
                        </span>
                        <span className="flex-none font-bold tabular">{t("home.stockLeft", { n: n(l.projected_qty) })}</span>
                      </div>
                    ))}
                    {data.low_stock_oil.map((l) => (
                      <div key={`o-${l.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="min-w-0">
                          <span className="text-muted-foreground">{t("home.stockOil")} </span>
                          <bdi className="font-semibold">{l.oil_type}</bdi>
                        </span>
                        <span className="flex-none font-bold tabular">
                          {t("home.stockLeft", { n: fmtLiters(l.projected_liters, locale) })}
                        </span>
                      </div>
                    ))}
                  </ListCard>
                </section>
              )}
            </>
          );
        }}
      </QueryState>
    </PageShell>
  );
}
