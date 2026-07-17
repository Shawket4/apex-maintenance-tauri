/**
 * The fleet Due list — the supervisor's morning. Grouped by urgency, and every
 * row carries the ODOMETER PROVENANCE its status was computed from: a due list
 * that doesn't say how stale its inputs are is a liability, because it looks
 * equally confident either way.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, CircleHelp, Gauge } from "lucide-react";

import { useDueList, type DueItem, type DueStatus } from "@/shared/api/maintenance";
import { SearchInput } from "@/shared/ui/SearchInput";
import { Card, CardContent } from "@/shared/ui/card";
import { cn } from "@/shared/lib/cn";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo, dayjs } from "@/shared/lib/time";

const STATUS_ORDER: DueStatus[] = ["overdue", "due_soon", "never_done", "ok"];

const STATUS_STYLE: Record<DueStatus, string> = {
  overdue: "bg-red-500/10 text-red-600 border-red-500/30",
  due_soon: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  never_done: "bg-slate-500/10 text-slate-500 border-slate-500/30",
  ok: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

export function statusLabelKey(s: DueStatus): string {
  return `due.status.${s}`;
}

export function sourceLabelKey(src: string): string {
  return `due.source.${src}`;
}

/** A reading older than this is suspect regardless of source. */
const STALE_AFTER_DAYS = 7;

export function OdometerBadge({ item }: { item: Pick<DueItem, "current_odometer" | "odometer_source" | "odometer_observed_at"> }) {
  const { t } = useTranslation();
  const observed = item.odometer_observed_at ? dayjs(item.odometer_observed_at) : null;
  const stale = observed ? dayjs().diff(observed, "day") >= STALE_AFTER_DAYS : true;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs tabular-nums",
        stale ? "text-amber-600" : "text-muted-foreground",
      )}
      title={observed ? fmtCairo(item.odometer_observed_at!) : t("due.neverObserved")}
    >
      {stale ? <AlertTriangle className="h-3 w-3" /> : <Gauge className="h-3 w-3" />}
      {fmtKm(item.current_odometer)}
      <span className="opacity-70">· {t(sourceLabelKey(item.odometer_source))}</span>
      {observed && <span className="opacity-70">· {observed.fromNow()}</span>}
    </span>
  );
}

export function DueBadge({ status }: { status: DueStatus }) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}>
      {t(statusLabelKey(status))}
    </span>
  );
}

/** "in 1,200 km" / "3 days overdue" — whichever axis the template runs on. */
export function dueDistance(t: (k: string, o?: Record<string, unknown>) => string, item: DueItem): string {
  if (item.trigger_type === "mileage" && item.next_due_km != null) {
    const d = item.next_due_km - item.current_odometer;
    return d >= 0
      ? t("due.inKm", { km: fmtNumber(d) })
      : t("due.overdueByKm", { km: fmtNumber(-d) });
  }
  if (item.trigger_type === "time" && item.next_due_at != null) {
    const d = dayjs(item.next_due_at).diff(dayjs(), "day");
    return d >= 0 ? t("due.inDays", { days: d }) : t("due.overdueByDays", { days: -d });
  }
  return t("due.status.never_done");
}

export function DuePage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useDueList();
  const [q, setQ] = useState("");
  const ar = i18n.language.startsWith("ar");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (data ?? []).filter(
      (d) =>
        !needle ||
        d.plate_number.toLowerCase().includes(needle) ||
        d.name_en.toLowerCase().includes(needle) ||
        d.name_ar.includes(needle),
    );
    return STATUS_ORDER.map((status) => ({
      status,
      items: filtered.filter((d) => d.status === status),
    }));
  }, [data, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("due.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("due.subtitle")}</p>
        </div>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("due.search")} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

      {groups.map(({ status, items }) =>
        items.length === 0 ? null : (
          <section key={status} className="space-y-2">
            <div className="flex items-center gap-2">
              <DueBadge status={status} />
              <span className="text-xs text-muted-foreground tabular-nums">{fmtNumber(items.length)}</span>
            </div>
            <Card>
              <CardContent className="p-0 divide-y divide-border">
                {items.map((item) => (
                  <Link
                    key={item.template_id}
                    to="/vehicles/$vehicleId"
                    params={{ vehicleId: String(item.vehicle_id) }}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <span className="font-semibold tabular-nums min-w-28" dir="rtl">
                      {item.plate_number}
                    </span>
                    <span className="flex items-center gap-1.5 min-w-44">
                      {item.trigger_type === "time" ? (
                        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {ar ? item.name_ar : item.name_en}
                    </span>
                    <span className={cn("text-sm tabular-nums", status === "overdue" ? "text-red-600 font-semibold" : "text-muted-foreground")}>
                      {item.status === "never_done" ? (
                        <span className="inline-flex items-center gap-1">
                          <CircleHelp className="h-3.5 w-3.5" />
                          {t("due.status.never_done")}
                        </span>
                      ) : (
                        dueDistance(t, item)
                      )}
                    </span>
                    <span className="ms-auto">
                      <OdometerBadge item={item} />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </section>
        ),
      )}

      {!isLoading && (data ?? []).length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t("due.empty")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
