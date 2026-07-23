import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PackageOpen } from "lucide-react";

import { useHome } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { dayjs, fmtAgo } from "@/shared/lib/time";
import { DUE_BADGE, DUE_DOT } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/")({
  component: HomePage,
});

/** الورشة — the operational answer to "what's happening right now".
 * Design 2026-07-23: KPI strip, open-work cards, the due list in one card. */
function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const home = useHome();

  if (home.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-5 p-7">
        <Skeleton className="h-14 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  const data = home.data;
  if (!data) return null;

  const kpis = [
    { n: data.open_wos.length, label: t("home.kpiOpen"), tone: "" },
    { n: data.due_counts.overdue, label: t("home.overdue"), tone: "text-status-overdue" },
    { n: data.due_counts.due_soon, label: t("home.dueSoon"), tone: "text-status-due_soon" },
    { n: data.sync_pending, label: t("wo.pending"), tone: "text-info" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-7 p-7">
      <div>
        <h1 className="text-[23px] font-bold leading-relaxed">{t("home.title")}</h1>
        <div className="text-xs text-muted-foreground">
          {dayjs().tz("Africa/Cairo").locale(i18n.language).format("dddd D MMMM")}
        </div>
      </div>

      {/* KPI strip — every number already lives in the home summary. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border bg-card px-5 py-4 shadow-sm">
            <div className={cn("text-[27px] font-bold leading-snug tabular", k.tone)}>
              {fmtNumber(k.n, i18n.language)}
            </div>
            <div className="text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Open work orders — the resume-work path. */}
      <section>
        <h2 className="mb-3 text-xs font-semibold text-muted-foreground">{t("home.openWos")}</h2>
        {data.open_wos.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("home.noOpenWos")}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.open_wos.map((w) => (
              <button
                key={w.id}
                onClick={() => void navigate({ to: "/wo/$woId", params: { woId: w.id } })}
                className="rounded-xl border bg-card p-[18px] text-start shadow-sm transition hover:border-border-strong hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-[17px] font-bold">{w.plate}</span>
                  {w.pending ? (
                    <Badge variant="outline">{t("wo.pending")}</Badge>
                  ) : (
                    <Badge className="bg-status-ok-soft text-status-ok hover:bg-status-ok-soft">
                      {t("wo.status.open")}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("home.openedAt")} {fmtAgo(w.opened_at, i18n.language)}
                  {" · "}
                  <span className="tabular">
                    {fmtNumber(w.task_count)} {t("common.items")}
                  </span>
                </div>
                <div className="mt-3 text-[13px] font-semibold text-primary">
                  {t("home.resume")} ←
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Due now — one card, one row per item. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted-foreground">{t("home.attention")}</h2>
          <Link to="/due" className="text-sm text-primary hover:underline">
            {t("home.viewAll")}
          </Link>
        </div>
        {data.attention.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("home.noAttention")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {data.attention.map((d, i) => (
              <Link
                key={`${d.vehicle_id}-${d.plan_id}`}
                to="/trucks/$truckId"
                params={{ truckId: String(d.vehicle_id) }}
                className={cn(
                  "flex items-center justify-between gap-3.5 px-[18px] py-3 transition hover:bg-primary/[0.03]",
                  i > 0 && "border-t",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("h-2 w-2 flex-none rounded-full", DUE_DOT[d.status])} />
                  <span className="whitespace-nowrap font-bold">{d.plate}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {i18n.language.startsWith("ar") ? d.category_name_ar : d.category_name_en}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      DUE_BADGE[d.status],
                    )}
                  >
                    {t(`due.status.${d.status}`)}
                  </span>
                </div>
                <span className="flex-none text-xs text-muted-foreground tabular">
                  {d.next_due_km != null
                    ? t("due.nextDueKm", { km: fmtNumber(d.next_due_km, i18n.language) })
                    : t(`due.status.${d.status}`)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Low stock. */}
      {(data.low_stock_tires.length > 0 || data.low_stock_oil.length > 0) && (
        <section>
          <Card className="border-status-due_soon/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-status-due_soon">
                <PackageOpen className="h-4 w-4" />
                {t("home.lowStock")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              {data.low_stock_tires.map((l) => (
                <Badge key={l.id} variant="outline" className="gap-1">
                  {l.brand} {l.model ?? ""}
                  <span className="tabular">{fmtNumber(l.projected_qty)}</span>
                </Badge>
              ))}
              {data.low_stock_oil.map((l) => (
                <Badge key={l.id} variant="outline" className="gap-1">
                  {l.oil_type}
                  <span className="tabular">
                    {fmtNumber(l.projected_liters)} {t("common.liters")}
                  </span>
                </Badge>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
