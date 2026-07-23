import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClipboardList, TriangleAlert, PackageOpen, ArrowLeft } from "lucide-react";

import { useHome } from "@/shared/api/queries";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtAgo } from "@/shared/lib/time";
import { DUE_BADGE, DUE_DOT } from "@/shared/lib/status";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

export const Route = createFileRoute("/_app/")({
  component: HomePage,
});

/** الورشة — the operational answer to "what's happening right now":
 * open work (resume in one click), what's due, what's running out. */
function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const home = useHome();

  if (home.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  const data = home.data;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">{t("home.title")}</h1>

      {/* Open work orders — the resume-work path. */}
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ClipboardList className="h-4 w-4" />
          {t("home.openWos")}
          {data.open_wos.length > 0 && (
            <Badge variant="secondary" className="tabular">{fmtNumber(data.open_wos.length)}</Badge>
          )}
        </div>
        {data.open_wos.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("home.noOpenWos")}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.open_wos.map((w) => (
              <button
                key={w.id}
                onClick={() => void navigate({ to: "/wo/$woId", params: { woId: w.id } })}
                className="group rounded-xl border bg-card p-4 text-start shadow-sm transition hover:border-border-strong hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold tracking-wide">{w.plate}</span>
                  {w.pending && <Badge variant="outline">{t("wo.pending")}</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("home.openedAt")} {fmtAgo(w.opened_at, i18n.language)}
                  {" · "}
                  <span className="tabular">
                    {fmtNumber(w.task_count)} {t("common.items")}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary">
                  {t("home.resume")}
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 rtl:rotate-0 ltr:rotate-180" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Due / overdue strip. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <TriangleAlert className="h-4 w-4" />
            {t("home.attention")}
            <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", DUE_BADGE.overdue)}>
              {fmtNumber(data.due_counts.overdue)} {t("home.overdue")}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", DUE_BADGE.due_soon)}>
              {fmtNumber(data.due_counts.due_soon)} {t("home.dueSoon")}
            </span>
          </div>
          <Link to="/due" className="text-sm text-primary hover:underline">
            {t("home.viewAll")}
          </Link>
        </div>
        {data.attention.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("home.noAttention")}
          </div>
        ) : (
          <div className="space-y-2">
            {data.attention.map((d) => (
              <Link
                key={`${d.vehicle_id}-${d.plan_id}`}
                to="/trucks/$truckId"
                params={{ truckId: String(d.vehicle_id) }}
                className="flex items-center justify-between rounded-xl border bg-card p-3 shadow-sm transition hover:border-border-strong hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className={cn("h-2.5 w-2.5 rounded-full", DUE_DOT[d.status])} />
                  <span className="font-semibold">{d.plate}</span>
                  <span className="text-sm text-muted-foreground">
                    {i18n.language.startsWith("ar") ? d.category_name_ar : d.category_name_en}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground tabular">
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
