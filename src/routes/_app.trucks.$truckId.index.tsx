import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import type { DueRow, WoListRow } from "@/shared/api/client";
import { useDue, useTruck, useWos } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { fmtAgo, fmtCairo } from "@/shared/lib/time";
import { Badge } from "@/shared/ui/badge";
import { QueryState } from "@/shared/ui/query-state";
import { DueRowItem } from "@/widgets/due/DueList";
import { dueBadge, needsAttention } from "@/widgets/due/dueText";
import { EmptyState } from "@/widgets/layout/PageShell";
import { ClassCard } from "@/widgets/truck/ClassCard";
import { OdometerCard } from "@/widgets/truck/OdometerCard";

export const Route = createFileRoute("/_app/trucks/$truckId/")({
  component: TruckOverview,
});

/** The truck at a glance: is its maintenance tracked at all (class), what
 * needs doing soonest (a summary — the full list is the "due" tab), the
 * odometer the due dates lean on, and its work orders. */
function TruckOverview() {
  const { t } = useTranslation();
  const { truckId } = Route.useParams();
  const vid = Number(truckId);
  const truck = useTruck(vid);
  const wos = useWos(undefined, vid);
  const due = useDue(vid);

  return (
    <div className="space-y-7">
      <QueryState query={truck}>
        {(tr) =>
          tr == null ? null : (
            <div className="grid gap-4 lg:grid-cols-2">
              <ClassCard truck={tr} />
              <OdometerCard vehicleId={vid} odometer={tr.odometer} />
            </div>
          )
        }
      </QueryState>

      {/* With no class there are no plans: the class card above already says
       * so, and an empty summary here would only repeat it. */}
      {truck.data != null && truck.data.plan_count > 0 && (
        <section>
          <SectionHeading
            title={t("truck.dueSummaryTitle")}
            action={
              <Link
                to="/trucks/$truckId/due"
                params={{ truckId }}
                replace
                className="flex min-h-10 items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                {t("truck.dueSeeAll")}
                <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" />
              </Link>
            }
          />
          <QueryState query={due}>{(rows) => <DueSummary rows={rows} truckId={truckId} />}</QueryState>
        </section>
      )}

      <section>
        <SectionHeading title={t("truck.wosTitle")} />
        <QueryState query={wos}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState>{t("truck.wosEmpty")}</EmptyState>
            ) : (
              <div className="space-y-2">
                {list.map((w) => (
                  <WoCard key={w.id} wo={w} />
                ))}
              </div>
            )
          }
        </QueryState>
      </section>
    </div>
  );
}

function SectionHeading({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3">
      <h2 className="text-base font-bold">{title}</h2>
      {action}
    </div>
  );
}

const SUMMARY_STATUSES = ["overdue", "never_done", "due_soon", "unknown", "ok"] as const;

/** Counts per status and the three most urgent items. The rows arrive
 * already sorted by urgency. */
function DueSummary({ rows, truckId }: { rows: DueRow[]; truckId: string }) {
  const { t, i18n } = useTranslation();
  const urgent = rows.filter((r) => needsAttention(r.status));
  const top = urgent.slice(0, 3);

  if (rows.length === 0) {
    return <EmptyState>{t("truck.dueNoPlans")}</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SUMMARY_STATUSES.map((s) => {
          const n = rows.filter((r) => r.status === s).length;
          if (n === 0) return null;
          return (
            <span
              key={s}
              className={cn("rounded-full px-3 py-1.5 text-sm font-semibold tabular", dueBadge(s))}
            >
              {t(`due.status.${s}`)}: {fmtNumber(n, i18n.language)}
            </span>
          );
        })}
      </div>

      {top.length === 0 ? (
        <div className="rounded-xl border bg-status-ok-soft p-4 text-sm font-semibold text-status-ok">
          {t("truck.dueAllFine")}
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {top.map((d) => (
            <DueRowItem key={d.plan_id} row={d} />
          ))}
        </div>
      )}

      {urgent.length > top.length && (
        <Link
          to="/trucks/$truckId/due"
          params={{ truckId }}
          replace
          className="flex min-h-10 w-fit items-center text-sm font-semibold text-primary underline"
        >
          {t("truck.dueMore", { n: fmtNumber(urgent.length - top.length, i18n.language) })}
        </Link>
      )}
    </div>
  );
}

function WoCard({ wo: w }: { wo: WoListRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const open = w.status === "open";
  const facts = [
    t("truck.woItems", { done: fmtNumber(w.done_count, lang), all: fmtNumber(w.task_count, lang) }),
    w.odometer_at_open != null ? fmtKm(w.odometer_at_open, lang) : null,
  ].filter(Boolean);
  const text = w.title?.trim() || w.notes?.trim() || null;

  return (
    <Link
      to="/wo/$woId"
      params={{ woId: w.id }}
      className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm transition hover:border-border-strong hover:shadow-md"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold tabular">
          {fmtCairo(w.opened_at, "YYYY/MM/DD", lang)}
          {open && (
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {fmtAgo(w.opened_at, lang)}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground tabular">{facts.join(" · ")}</div>
        {text && <div className="mt-0.5 line-clamp-1 text-sm">{text}</div>}
      </div>
      <Badge
        className={cn(
          "flex-none",
          open
            ? "bg-status-ok-soft text-status-ok hover:bg-status-ok-soft"
            : "bg-muted text-muted-foreground hover:bg-muted",
        )}
      >
        {t(`wo.status.${w.status}`)}
      </Badge>
    </Link>
  );
}
